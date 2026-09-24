import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

import {
    getFirestore,
    collection,
    getDocs,
    doc,
    setDoc,
    addDoc,
    updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";


/* =========================================================
   FIREBASE
========================================================= */

const firebaseConfig = {
    apiKey: "AIzaSyDXHA-l-TqWGijVXDoOk5nGw0YFrgzM5yA".replaceAll(" ", ""),
    authDomain: "coreworks-store.firebaseapp.com",
    projectId: "coreworks-store",
    storageBucket: "coreworks-store.firebasestorage.app",
    messagingSenderId: "661100888687",
    appId: "1:661100888687:web:b94d01928ef5e82c13039a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


/* =========================================================
   GLOBAL DATA
========================================================= */

let user = null;
let items = [];
let suppliers = [];
let history = [];
let currentRole = "staff";
const ADMIN_EMAILS = [
    "design@coreworkstrading.com",
    "asela@coreworkstrading.com"
];

function isAdmin() {
    return currentRole === "admin";
}

function applyPermissions() {
    currentRole = user && ADMIN_EMAILS.includes(String(user.email || "").toLowerCase()) ? "admin" : "staff";

    const stockValueCard = document.querySelector(".stock-value-card");
    if (stockValueCard) stockValueCard.classList.toggle("hidden", !isAdmin());

    const addItemButton = $("addItem");
    if (addItemButton) addItemButton.classList.toggle("hidden", !isAdmin());

    const backupMenu = $("backupMenu");
    if (backupMenu) backupMenu.classList.toggle("hidden", !isAdmin());
}

async function logActivity(action, item = null, reference = "-") {
    await addDoc(collection(db, "activityLogs"), {
        action,
        itemNo: item?.itemNo || "-",
        itemName: item?.itemName || "-",
        quantity: 0,
        reference,
        performedBy: user?.email || "-",
        createdAt: serverTimestamp()
    });
}

const $ = id => document.getElementById(id);

const esc = value =>
    String(value ?? "").replace(
        /[&<>"']/g,
        m => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[m]
    );

function ms(value) {

    if (!value) return 0;

    if (value.toMillis)
        return value.toMillis();

    if (value.seconds)
        return value.seconds * 1000;

    return new Date(value).getTime();
}

function money(value) {

    return "Rs. " + Number(value || 0).toLocaleString(
        "en-LK",
        {
            minimumFractionDigits: 2
        }
    );
}

function daysUntil(value) {

    if (!value)
        return null;

    return Math.ceil(
        (ms(value) - Date.now()) / 86400000
    );
}


/* =========================================================
   LOGIN
========================================================= */

onAuthStateChanged(
    auth,
    async currentUser => {

        user = currentUser;

        if (currentUser) {

            $("loginView").classList.add("hidden");
            $("app").classList.remove("hidden");

            $("user").textContent =
                currentUser.email;

            applyPermissions();
            await refresh();

        } else {

            $("app").classList.add("hidden");
            $("loginView").classList.remove("hidden");
        }
    }
);


$("loginForm").onsubmit =
    async event => {

        event.preventDefault();

        $("error").textContent = "";

        try {

            await signInWithEmailAndPassword(
                auth,
                $("email").value,
                $("password").value
            );

        } catch (error) {

            $("error").textContent =
                error.message;
        }
    };


$("logout").onclick =
    () => signOut(auth);


$("refresh").onclick =
    refresh;


/* =========================================================
   MENU
========================================================= */

document
    .querySelectorAll("aside button[data-page]")
    .forEach(button => {

        button.onclick = () => {

            document
                .querySelectorAll(".page")
                .forEach(page =>
                    page.classList.add("hidden")
                );

            $(button.dataset.page)
                .classList.remove("hidden");

            $("title").textContent =
                button.textContent.trim();
        };
    });


/* =========================================================
   FIRESTORE LOAD
========================================================= */

async function getCollection(name) {

    const snapshot =
        await getDocs(
            collection(db, name)
        );

    return snapshot.docs.map(
        document => ({
            id: document.id,
            ...document.data()
        })
    );
}


async function refresh() {

    try {

        items =
            await getCollection("items");

        suppliers =
            await getCollection("suppliers");

        const stockIn =
            await getCollection("stockIn");

        const stockOut =
            await getCollection("stockOut");

        const activityLogs =
            await getCollection("activityLogs");

        history = [

            ...stockIn.map(
                record => ({
                    ...record,
                    type: "IN"
                })
            ),

            ...stockOut.map(
                record => ({
                    ...record,
                    type: "OUT"
                })
            ),

            ...activityLogs.map(
                record => ({
                    ...record,
                    type: "ACTIVITY"
                })
            )

        ].sort(
            (a, b) =>
                ms(b.createdAt) -
                ms(a.createdAt)
        );

        dashboard();

        renderItems();

        loadSelects();

        renderSuppliers();

        renderHistory();

        renderStockReport();

        renderBackupSummary();

    } catch (error) {

        console.error(error);

        alert(error.message);
    }
}


/* =========================================================
   DASHBOARD
========================================================= */

function dashboard() {

    const now = Date.now();
    const sixMonths = 183 * 24 * 60 * 60 * 1000;
    const twelveMonths = 365 * 24 * 60 * 60 * 1000;

    const lowStock =
        items.filter(
            item =>
                Number(item.stockQty || 0) <=
                Number(item.minimumQty || 0)
        );

    // Dashboard warning is specifically 7 days.
    // Already expired items are also kept in this warning list until their
    // expired stock is removed.
    const expiring =
        items.filter(item => {

            const effectiveExpiry =
                getEffectiveExpiry(item);

            if (!effectiveExpiry)
                return false;

            const days =
                daysUntil(effectiveExpiry);

            return (
                days !== null &&
                days <= 7
            );
        });

    const oneTimeNonMoving =
        items.filter(item => {

            const itemCreated = ms(item.createdAt);

            // Item must first be at least 6 months old.
            if (!itemCreated || now - itemCreated < sixMonths)
                return false;

            const issuesLast6Months =
                history.filter(
                    record =>
                        record.type === "OUT" &&
                        record.itemNo === item.itemNo &&
                        ms(record.createdAt) &&
                        now - ms(record.createdAt) <= sixMonths
                );

            return issuesLast6Months.length === 1;
        });

    const nonMoving =
        items.filter(item => {

            const itemCreated =
                ms(item.createdAt);

            // Do not mark a newly-created item as 12-month non-moving.
            if (
                !itemCreated ||
                now - itemCreated < twelveMonths
            )
                return false;

            const movementsLast12Months =
                history.filter(
                    record =>
                        record.itemNo === item.itemNo &&
                        ms(record.createdAt) &&
                        now - ms(record.createdAt) <= twelveMonths
                );

            return movementsLast12Months.length === 0;
        });

    const stockValue =
        items.reduce(
            (total, item) =>
                total +
                Number(item.stockQty || 0) *
                Number(item.buyingPrice || 0),
            0
        );

    $("nItems").textContent =
        items.length;

    $("nLow").textContent =
        lowStock.length;

    $("nExp").textContent =
        expiring.length;

    if (isAdmin() && $("nVal"))
        $("nVal").textContent = money(stockValue);

    $("low").innerHTML =
        lowStock
            .map(
                item => `
                <p>
                    ${esc(item.itemNo)}
                    —
                    ${esc(item.itemName)}
                    |
                    <b>
                        ${item.stockQty || 0}
                        /
                        ${item.minimumQty || 0}
                    </b>
                </p>
            `
            )
            .join("")
        ||
        "<p>No alerts.</p>";

    $("exp").innerHTML =
        expiring
            .map(
                item => `
                <p>
                    ${esc(item.itemNo)}
                    —
                    ${esc(item.itemName)}
                    |
                    <b>
                        ${
                            daysUntil(getEffectiveExpiry(item)) < 0
                                ? `Expired ${Math.abs(daysUntil(getEffectiveExpiry(item)))} day(s) ago`
                                : `${daysUntil(getEffectiveExpiry(item))} day(s)`
                        }
                    </b>
                </p>
            `
            )
            .join("")
        ||
        "<p>No expiring items.</p>";

    $("oneTimeNonMoving").innerHTML =
        oneTimeNonMoving
            .map(
                item => `
                <p>
                    ${esc(item.itemNo)}
                    —
                    ${esc(item.itemName)}
                    |
                    <b>Used once in last 6 months</b>
                </p>
            `
            )
            .join("")
        ||
        "<p>No one-time non moving items.</p>";

    $("nonMoving").innerHTML =
        nonMoving
            .map(
                item => `
                <p>
                    ${esc(item.itemNo)}
                    —
                    ${esc(item.itemName)}
                    |
                    <b>No movement in last 12 months</b>
                </p>
            `
            )
            .join("")
        ||
        "<p>No non-moving items.</p>";

    if (isAdmin()) renderStockValueSelector(stockValue);
}


function renderStockValueSelector(totalStockValue) {

    const select =
        $("stockValueItem");

    if (!select)
        return;

    const previousValue =
        select.value || "all";

    select.innerHTML =
        `<option value="all">All Items - Total Stock Value</option>` +
        items
            .slice()
            .sort(
                (a, b) =>
                    String(a.itemNo || "")
                        .localeCompare(
                            String(b.itemNo || "")
                        )
            )
            .map(
                item => `
                    <option value="${esc(item.id)}">
                        ${esc(item.itemNo)} — ${esc(item.itemName)}
                    </option>
                `
            )
            .join("");

    if (
        previousValue === "all" ||
        items.some(item => item.id === previousValue)
    )
        select.value = previousValue;
    else
        select.value = "all";

    const updateSelectedValue = () => {

        if (select.value === "all") {

            $("nVal").textContent =
                money(totalStockValue);

            $("selectedStockValue").innerHTML =
                `Total stock value: <b>${money(totalStockValue)}</b>`;

            return;
        }

        const item =
            items.find(
                current =>
                    current.id === select.value
            );

        if (!item)
            return;

        const value =
            Number(item.stockQty || 0) *
            Number(item.buyingPrice || 0);

        $("nVal").textContent =
            money(value);

        $("selectedStockValue").innerHTML =
            `${esc(item.itemNo)} — ${esc(item.itemName)}<br>` +
            `Stock: <b>${Number(item.stockQty || 0)}</b> × ` +
            `Buying: <b>${money(item.buyingPrice)}</b><br>` +
            `Item Stock Value: <b>${money(value)}</b>`;
    };

    select.onchange =
        updateSelectedValue;

    updateSelectedValue();
}

function getEffectiveExpiry(item) {
    const itemBatches = history.filter(
        record => record.type === "IN" && record.itemNo === item.itemNo
    );

    const activeExpiries = itemBatches
        .filter(record =>
            Number(record.remainingQty ?? record.quantity ?? 0) > 0 &&
            record.expiryDate
        )
        .map(record => record.expiryDate)
        .sort((a, b) => ms(a) - ms(b));

    if (activeExpiries.length) return activeExpiries[0];

    // Old items created before batch tracking.
    if (itemBatches.length === 0) return item.expiryDate || null;

    return null;
}


/* =========================================================
   ITEM STATUS / COLORS
========================================================= */

function getItemStatus(item) {

    /*
       PRIORITY

       1 RED       = expiry within 30 days
       2 ORANGE    = minimum stock
       3 LIGHT RED = no movement for 12 months
       4 BLUE      = only one issue in 6 months
       5 NORMAL
    */


    const effectiveExpiry = getEffectiveExpiry(item);

    if (effectiveExpiry) {

        const remainingDays =
            daysUntil(effectiveExpiry);

        if (
            remainingDays !== null &&
            remainingDays <= 30
        ) {

            return {
                key: "expiry",
                label: remainingDays < 0 ? "Expired" : "Expiry ≤ 30 Days",
                className: "row-expiry"
            };
        }
    }


    if (
        Number(item.stockQty || 0) <=
        Number(item.minimumQty || 0)
    ) {

        return {
            key: "minimum",
            label: "Minimum Stock",
            className: "row-minimum"
        };
    }


    const itemHistory =
        history.filter(
            record =>
                record.itemNo ===
                item.itemNo
        );


    /*
       Old items only:
       No movement during last 12 months.
    */

    const itemCreated =
        ms(item.createdAt);

    const twelveMonths =
        365 * 24 * 60 * 60 * 1000;

    const sixMonths =
        183 * 24 * 60 * 60 * 1000;

    const now =
        Date.now();


    const movementLast12Months =
        itemHistory.filter(
            record =>
                ms(record.createdAt) &&
                now - ms(record.createdAt)
                    <= twelveMonths
        );


    /*
       Important:
       New items should NOT immediately
       become "No Movement 12 Months".
    */

    if (
        itemCreated &&
        now - itemCreated >= twelveMonths &&
        movementLast12Months.length === 0
    ) {

        return {
            key: "nomove",
            label: "No Movement / 12 Months",
            className: "row-nomove"
        };
    }


    /*
       OUT / ISSUE transactions
       during last 6 months.
    */

    const issueLast6Months =
        itemHistory.filter(
            record =>
                record.type === "OUT" &&
                ms(record.createdAt) &&
                now - ms(record.createdAt)
                    <= sixMonths
        );


    if (
        itemCreated &&
        now - itemCreated >= sixMonths &&
        issueLast6Months.length === 1
    ) {

        return {
            key: "lowuse",
            label: "Used Once / 6 Months",
            className: "row-lowuse"
        };
    }


    return {
        key: "normal",
        label: "Normal",
        className: ""
    };
}


/* =========================================================
   ITEM FILTERS
========================================================= */

function filterValue(id) {

    const element = $(id);

    if (!element)
        return "";

    return element.value
        .trim()
        .toLowerCase();
}


function matchesFilter(
    value,
    filter
) {

    if (!filter)
        return true;

    return String(value ?? "")
        .toLowerCase()
        .includes(filter);
}


/* =========================================================
   ITEMS TABLE
========================================================= */

function renderItems() {

    const search =
        filterValue("search");

    const statusFilter =
        $("statusFilter")
            ? $("statusFilter").value
            : "all";


    let filtered =
        items.filter(item => {

            const status =
                getItemStatus(item);


            const generalSearch = [

                item.itemNo,
                item.location,
                item.itemName,
                item.description,
                item.specification,
                item.unitType,
                item.unit,
                item.stockQty,
                item.minimumQty,
                item.supplierName,
                item.buyingPrice

            ]
                .join(" ")
                .toLowerCase();


            if (
                search &&
                !generalSearch.includes(search)
            )
                return false;


            if (
                statusFilter !== "all" &&
                status.key !== statusFilter
            )
                return false;


            if (
                !matchesFilter(
                    item.itemNo,
                    filterValue("fItemNo")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.location,
                    filterValue("fLocation")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.itemName,
                    filterValue("fName")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.description,
                    filterValue("fDescription")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.specification,
                    filterValue("fSpecification")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.unitType || item.unit,
                    filterValue("fUnit")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.stockQty,
                    filterValue("fStock")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.minimumQty,
                    filterValue("fMin")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.supplierName,
                    filterValue("fSupplier")
                )
            )
                return false;


            if (
                !matchesFilter(
                    item.buyingPrice,
                    filterValue("fBuying")
                )
            )
                return false;


            return true;
        });


    $("itemRows").innerHTML =
        filtered
            .map(item => {

                const status =
                    getItemStatus(item);

                const effectiveExpiry = getEffectiveExpiry(item);

                const expiry =
                    effectiveExpiry
                        ?
                        new Date(
                            ms(effectiveExpiry)
                        )
                            .toLocaleDateString(
                                "en-GB"
                            )
                        :
                        "-";


                return `
                    <tr class="${status.className}">

                        <td>
                            ${
                                item.imageUrl &&
                                item.imageUrl !== "-"
                                    ?
                                    `<img
                                        class="thumb"
                                        src="${esc(item.imageUrl)}"
                                    >`
                                    :
                                    ""
                            }
                        </td>

                        <td>
                            ${esc(item.itemNo)}
                        </td>

                        <td>
                            ${esc(item.location || "-")}
                        </td>

                        <td>
                            ${esc(item.itemName)}
                        </td>

                        <td>
                            ${esc(item.description || "-")}
                        </td>

                        <td>
                            ${esc(item.specification || "-")}
                        </td>

                        <td>
                            ${esc(
                                item.unitType ||
                                item.unit ||
                                ""
                            )}

                            ${
                                item.pcsPerUnit
                                    ?
                                    ` (${item.pcsPerUnit} pcs/u)`
                                    :
                                    ""
                            }
                        </td>

                        <td>
                            ${item.stockQty || 0}
                        </td>

                        <td>
                            ${item.minimumQty || 0}
                        </td>

                        <td>
                            ${esc(item.supplierName || "-")}
                        </td>

                        <td>
                            ${money(item.buyingPrice)}
                        </td>

                        <td>
                            ${expiry}
                        </td>

                        <td>
                            <b>
                                ${esc(status.label)}
                            </b>
                        </td>

                        <td class="actions">

                            ${isAdmin() ? `
                            <button
                                onclick="window.editItem('${item.id}')"
                            >
                                Edit
                            </button>` : ""}

                            <button
                                onclick="window.itemBarcode('${item.id}')"
                            >
                                Barcode
                            </button>

                            <button
                                onclick="window.moreItem('${item.id}')"
                            >
                                More
                            </button>

                        </td>

                    </tr>
                `;
            })
            .join("")
        ||
        `
            <tr>
                <td colspan="14">
                    No items found.
                </td>
            </tr>
        `;
}


/* =========================================================
   FILTER EVENTS
========================================================= */

[
    "search",
    "fItemNo",
    "fLocation",
    "fName",
    "fDescription",
    "fSpecification",
    "fUnit",
    "fStock",
    "fMin",
    "fSupplier",
    "fBuying"
]
.forEach(id => {

    const element =
        $(id);

    if (element)
        element.addEventListener(
            "input",
            renderItems
        );
});


if ($("statusFilter")) {

    $("statusFilter")
        .addEventListener(
            "change",
            renderItems
        );
}


/* =========================================================
   SELECT LISTS
========================================================= */

function loadSelects() {

    const itemOptions =
        items
            .map(
                item => `
                    <option value="${item.id}">
                        ${esc(item.itemNo)}
                        —
                        ${esc(item.itemName)}
                    </option>
                `
            )
            .join("");


    $("inItem").innerHTML =
        itemOptions;

    $("outItem").innerHTML =
        itemOptions;


    const supplierOptions =

        `<option value="">
            Select Supplier
        </option>`

        +

        suppliers
            .filter(
                supplier =>
                    supplier.active !== false
            )
            .map(
                supplier => `
                    <option
                        value="${esc(
                            supplier.companyName
                        )}"
                    >
                        ${esc(
                            supplier.companyName
                        )}
                    </option>
                `
            )
            .join("");


    $("inSupplier").innerHTML =
        supplierOptions;
}




/* =========================================================
   ADMIN SYSTEM BACKUP
========================================================= */

function renderBackupSummary() {
    if ($("backupItemsCount"))
        $("backupItemsCount").textContent = items.length;

    if ($("backupSuppliersCount"))
        $("backupSuppliersCount").textContent = suppliers.length;

    if ($("backupHistoryCount"))
        $("backupHistoryCount").textContent = history.length;
}

function cleanBackupValue(value) {
    if (value === null || value === undefined) return value;

    if (typeof value?.toDate === "function")
        return value.toDate().toISOString();

    if (typeof value?.seconds === "number")
        return new Date(value.seconds * 1000).toISOString();

    if (Array.isArray(value))
        return value.map(cleanBackupValue);

    if (typeof value === "object") {
        const output = {};
        Object.entries(value).forEach(([key, current]) => {
            output[key] = cleanBackupValue(current);
        });
        return output;
    }

    return value;
}

async function exportSystemBackup() {
    if (!isAdmin()) {
        alert("Admin access is required to export a backup.");
        return;
    }

    const button = $("exportBackup");
    const originalText = button ? button.textContent : "Export Backup";

    try {
        if (button) {
            button.disabled = true;
            button.textContent = "Preparing Backup...";
        }

        // Read fresh data directly from Firestore at export time.
        const [
            backupItems,
            backupSuppliers,
            backupStockIn,
            backupStockOut,
            backupActivityLogs
        ] = await Promise.all([
            getCollection("items"),
            getCollection("suppliers"),
            getCollection("stockIn"),
            getCollection("stockOut"),
            getCollection("activityLogs")
        ]);

        const backup = cleanBackupValue({
            backupInfo: {
                system: "Coreworks Store Management System",
                company: "Coreworks Trading (Pvt) Ltd.",
                version: 1,
                exportedAt: new Date().toISOString(),
                exportedBy: user?.email || "-"
            },
            items: backupItems,
            suppliers: backupSuppliers,
            stockIn: backupStockIn,
            stockOut: backupStockOut,
            activityLogs: backupActivityLogs
        });

        const json = JSON.stringify(backup, null, 2);
        const blob = new Blob([json], {
            type: "application/json;charset=utf-8"
        });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const stamp =
            now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, "0") + "-" +
            String(now.getDate()).padStart(2, "0") + "_" +
            String(now.getHours()).padStart(2, "0") + "-" +
            String(now.getMinutes()).padStart(2, "0");

        const link = document.createElement("a");
        link.href = url;
        link.download = `Coreworks_Backup_${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);

        await logActivity(
            "SYSTEM_BACKUP_EXPORTED",
            null,
            `Backup ${stamp}`
        );

        alert("Backup downloaded successfully to this device.");
        await refresh();

    } catch (error) {
        console.error("Backup export error:", error);
        alert("Backup could not be created: " + error.message);

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

if ($("exportBackup"))
    $("exportBackup").addEventListener(
        "click",
        exportSystemBackup
    );

/* =========================================================
   CURRENT STOCK REPORT / A4 PDF
========================================================= */

function getCurrentStockReportItems() {
    return items
        .filter(item => Number(item.stockQty || 0) > 0)
        .slice()
        .sort((a, b) =>
            String(a.itemNo || "").localeCompare(String(b.itemNo || ""))
        );
}

function reportDate(value) {
    if (!value) return "-";
    const time = ms(value);
    if (!time) return "-";
    return new Date(time).toLocaleDateString("en-GB");
}

function renderStockReport() {
    const rows = $("reportRows");
    if (!rows) return;

    const data = getCurrentStockReportItems();
    const totalQty = data.reduce(
        (sum, item) => sum + Number(item.stockQty || 0),
        0
    );

    if ($("reportItemCount"))
        $("reportItemCount").textContent = data.length;

    if ($("reportTotalQty"))
        $("reportTotalQty").textContent =
            Number(totalQty).toLocaleString("en-LK");

    if ($("reportGeneratedAt"))
        $("reportGeneratedAt").textContent =
            new Date().toLocaleString("en-GB");

    rows.innerHTML = data.map(item => {
        const expiry = getEffectiveExpiry(item);
        const status = getItemStatus(item);

        return `
            <tr class="${status.className}">
                <td>${esc(item.itemNo || "-")}</td>
                <td>${esc(item.itemName || "-")}</td>
                <td>${esc(item.description || "-")}</td>
                <td>${esc(item.specification || "-")}</td>
                <td>${esc(item.location || "-")}</td>
                <td>${esc(item.unitType || item.unit || "-")}</td>
                <td><b>${Number(item.stockQty || 0)}</b></td>
                <td>${Number(item.minimumQty || 0)}</td>
                <td>${esc(item.supplierName || "-")}</td>
                <td>${expiry ? reportDate(expiry) : "-"}</td>
                <td>${esc(status.label)}</td>
            </tr>
        `;
    }).join("") || `
        <tr>
            <td colspan="11">No items currently in stock.</td>
        </tr>
    `;
}

function downloadCurrentStockPDF() {
    const data = getCurrentStockReportItems();

    if (!data.length) {
        alert("No items currently in stock.");
        return;
    }

    if (!window.jspdf || !window.jspdf.jsPDF) {
        alert("PDF library did not load. Check the internet connection and refresh the page.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4"
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const generated = new Date();

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text("COREWORKS TRADING (PVT) LTD.", 14, 15);

    pdf.setFontSize(12);
    pdf.text("Current Stock Report", 14, 22);

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(
        `Generated: ${generated.toLocaleString("en-GB")}`,
        14,
        28
    );
    pdf.text(
        `Items in stock: ${data.length}`,
        pageWidth - 14,
        28,
        { align: "right" }
    );

    const body = data.map(item => {
        const expiry = getEffectiveExpiry(item);
        const status = getItemStatus(item);

        return [
            item.itemNo || "-",
            item.itemName || "-",
            item.description || "-",
            item.specification || "-",
            item.location || "-",
            item.unitType || item.unit || "-",
            String(Number(item.stockQty || 0)),
            String(Number(item.minimumQty || 0)),
            item.supplierName || "-",
            expiry ? reportDate(expiry) : "-",
            status.label
        ];
    });

    pdf.autoTable({
        startY: 33,
        head: [[
            "Item No",
            "Item Name",
            "Description",
            "Specification",
            "Location",
            "Unit",
            "Stock",
            "Min",
            "Supplier",
            "Expiry",
            "Status"
        ]],
        body,
        theme: "grid",
        styles: {
            font: "helvetica",
            fontSize: 6.7,
            cellPadding: 1.7,
            overflow: "linebreak",
            valign: "middle"
        },
        headStyles: {
            fillColor: [17, 24, 39],
            textColor: [255, 255, 255],
            fontStyle: "bold"
        },
        columnStyles: {
            0: { cellWidth: 20 },
            1: { cellWidth: 31 },
            2: { cellWidth: 36 },
            3: { cellWidth: 30 },
            4: { cellWidth: 20 },
            5: { cellWidth: 15 },
            6: { cellWidth: 15, halign: "right" },
            7: { cellWidth: 14, halign: "right" },
            8: { cellWidth: 29 },
            9: { cellWidth: 20 },
            10: { cellWidth: 30 }
        },
        didDrawPage: function () {
            const pageNo = pdf.internal.getNumberOfPages();
            const pageHeight = pdf.internal.pageSize.getHeight();

            pdf.setFontSize(7);
            pdf.setTextColor(100);
            pdf.text(
                `Coreworks Store Management System  |  Page ${pageNo}`,
                14,
                pageHeight - 6
            );
        }
    });

    const stamp =
        generated.getFullYear() + "-" +
        String(generated.getMonth() + 1).padStart(2, "0") + "-" +
        String(generated.getDate()).padStart(2, "0");

    pdf.save(`Coreworks_Current_Stock_Report_${stamp}.pdf`);
}

if ($("downloadStockPdf"))
    $("downloadStockPdf").addEventListener(
        "click",
        downloadCurrentStockPDF
    );

/* =========================================================
   BARCODE SEARCH / CAMERA SCANNER - ISSUE
========================================================= */

function selectIssueItemByCode(rawCode, showNotFound = false) {
    const search = String(rawCode || "").trim().toLowerCase();

    if (!search) return false;

    const item = items.find(current =>
        String(current.itemNo || "").trim().toLowerCase() === search ||
        String(current.barcode || "").trim().toLowerCase() === search
    );

    if (item) {
        $("barcode").value = item.itemNo || rawCode;
        $("outItem").value = item.id;
        return true;
    }

    if (showNotFound)
        alert(`No item found for barcode / item no: ${rawCode}`);

    return false;
}

$("barcode").addEventListener("change", () => {
    selectIssueItemByCode($("barcode").value);
});

$("barcode").addEventListener("input", () => {
    const value = $("barcode").value.trim();
    if (value) selectIssueItemByCode(value);
});

let barcodeCodeReader = null;
let barcodeScannerRunning = false;
let barcodeScanLocked = false;
let barcodeScannerMode = "issue";

function selectReceivingItemByCode(rawCode, showNotFound = false) {
    const search = String(rawCode || "").trim().toLowerCase();
    if (!search) return false;

    const item = items.find(current =>
        String(current.itemNo || "").trim().toLowerCase() === search ||
        String(current.barcode || "").trim().toLowerCase() === search
    );

    if (item) {
        if ($("inBarcode")) $("inBarcode").value = item.itemNo || rawCode;
        $("inItem").value = item.id;
        return true;
    }

    if (showNotFound)
        alert(`No item found for barcode / item no: ${rawCode}`);

    return false;
}

if ($("inBarcode")) {
    $("inBarcode").addEventListener("change", () => {
        selectReceivingItemByCode($("inBarcode").value);
    });

    $("inBarcode").addEventListener("input", () => {
        const value = $("inBarcode").value.trim();
        if (value) selectReceivingItemByCode(value);
    });
}

async function openBarcodeScanner(mode = "issue") {
    barcodeScannerMode = mode;
    const scanner = $("barcodeScanner");
    const video = $("barcodeVideo");
    const status = $("scannerStatus");

    if (!scanner || !video) return;

    if (!window.isSecureContext) {
        alert("Camera scanning needs HTTPS. Open the GitHub Pages HTTPS website and try again.");
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Camera access is not supported in this browser.");
        return;
    }

    if (!window.ZXing) {
        alert("Barcode scanner library did not load. Check the internet connection and refresh the page.");
        return;
    }

    scanner.classList.remove("hidden");
    scanner.setAttribute("aria-hidden", "false");
    document.body.classList.add("scanner-open");
    status.textContent = "Starting camera…";
    barcodeScanLocked = false;

    try {
        barcodeCodeReader = new ZXing.BrowserMultiFormatReader();
        barcodeScannerRunning = true;

        const devices = await barcodeCodeReader.listVideoInputDevices();
        let deviceId;

        if (devices && devices.length) {
            const rear = devices.find(device =>
                /back|rear|environment/i.test(device.label || "")
            );
            deviceId = (rear || devices[devices.length - 1]).deviceId;
        }

        status.textContent = "Point the camera at a barcode";

        await barcodeCodeReader.decodeFromVideoDevice(
            deviceId,
            video,
            (result, error) => {
                if (!barcodeScannerRunning || barcodeScanLocked) return;

                if (result) {
                    const code = result.getText();
                    barcodeScanLocked = true;

                    const found = barcodeScannerMode === "receiving"
                        ? selectReceivingItemByCode(code, true)
                        : selectIssueItemByCode(code, true);

                    if (found) {
                        if (navigator.vibrate) navigator.vibrate(80);
                        closeBarcodeScanner();

                        if (barcodeScannerMode === "receiving")
                            $("inQty")?.focus();
                        else
                            $("outQty")?.focus();
                    } else {
                        barcodeScanLocked = false;
                        status.textContent = `Not found: ${code}. Try again.`;
                    }
                }
            }
        );
    } catch (error) {
        console.error("Barcode scanner error:", error);
        closeBarcodeScanner();

        if (error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError"))
            alert("Camera permission was blocked. Allow camera access for this site and try again.");
        else
            alert("Could not start the camera scanner. Please check camera permission and try again.");
    }
}

function closeBarcodeScanner() {
    barcodeScannerRunning = false;
    barcodeScanLocked = false;

    if (barcodeCodeReader) {
        try { barcodeCodeReader.reset(); } catch (error) { console.warn(error); }
        barcodeCodeReader = null;
    }

    const video = $("barcodeVideo");
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

    const scanner = $("barcodeScanner");
    if (scanner) {
        scanner.classList.add("hidden");
        scanner.setAttribute("aria-hidden", "true");
    }

    document.body.classList.remove("scanner-open");
}

if ($("openBarcodeScanner"))
    $("openBarcodeScanner").addEventListener("click", () => openBarcodeScanner("issue"));

if ($("openReceivingBarcodeScanner"))
    $("openReceivingBarcodeScanner").addEventListener("click", () => openBarcodeScanner("receiving"));

if ($("closeBarcodeScanner"))
    $("closeBarcodeScanner").addEventListener("click", closeBarcodeScanner);

document.addEventListener("visibilitychange", () => {
    if (document.hidden && barcodeScannerRunning)
        closeBarcodeScanner();
});


/* =========================================================
   RECEIVING
========================================================= */

$("inForm").onsubmit =
    async event => {

        event.preventDefault();


        const item =
            items.find(
                current =>
                    current.id ===
                    $("inItem").value
            );


        if (!item)
            return;


        const quantity =
            Number(
                $("inQty").value
            );


        const price =
            Number(
                $("inPrice").value
            );


        await addDoc(
            collection(
                db,
                "stockIn"
            ),
            {

                itemNo:
                    item.itemNo,

                itemName:
                    item.itemName,

                quantity,

                unit:
                    item.unitType ||
                    item.unit ||
                    "",

                unitType:
                    item.unitType ||
                    null,

                pcsPerUnit:
                    Number(
                        item.pcsPerUnit || 1
                    ),

                buyingPrice:
                    price,

                supplierName:
                    $("inSupplier").value,

                invoiceNo:
                    $("inInvoice").value,

                expiryDate:
                    $("inExpiry").value
                        ?
                        new Date(
                            $("inExpiry").value +
                            "T00:00:00"
                        )
                        :
                        null,

                receivedQty:
                    quantity,

                remainingQty:
                    quantity,

                batchStatus:
                    quantity > 0 ? "OPEN" : "CLOSED",

                enteredBy:
                    user.email,

                createdAt:
                    serverTimestamp()
            }
        );


        const newQuantity =
            Number(
                item.stockQty || 0
            )
            +
            quantity;


        const updateData = {

            stockQty:
                newQuantity,

            totalPcs:
                newQuantity *
                Number(
                    item.pcsPerUnit || 1
                ),

            buyingPrice:
                price
        };


        if ($("inSupplier").value) {

            updateData.supplierName =
                $("inSupplier").value;
        }


        if ($("inExpiry").value) {

            updateData.expiryDate =
                new Date(
                    $("inExpiry").value +
                    "T00:00:00"
                );
        }


        await updateDoc(
            doc(
                db,
                "items",
                item.id
            ),
            updateData
        );


        event.target.reset();

        await refresh();

        alert(
            "Receiving saved successfully."
        );
    };


/* =========================================================
   FIFO BATCH ALLOCATION
========================================================= */

async function allocateFifoBatches(item, quantity) {
    const snapshot = await getDocs(collection(db, "stockIn"));

    const batches = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(r =>
            r.itemNo === item.itemNo &&
            Number(r.remainingQty ?? r.quantity ?? 0) > 0
        )
        .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

    let left = quantity;
    const allocations = [];

    for (const batch of batches) {
        if (left <= 0) break;

        const available = Number(batch.remainingQty ?? batch.quantity ?? 0);
        const used = Math.min(available, left);
        const remaining = available - used;

        await updateDoc(doc(db, "stockIn", batch.id), {
            remainingQty: remaining,
            batchStatus: remaining > 0 ? "OPEN" : "CLOSED"
        });

        allocations.push({
            stockInId: batch.id,
            invoiceNo: batch.invoiceNo || "",
            supplierName: batch.supplierName || "",
            buyingPrice: Number(batch.buyingPrice || 0),
            quantity: used
        });

        left -= used;
    }

    // Old stock created before batch tracking remains usable.
    if (left > 0) {
        allocations.push({
            stockInId: "",
            invoiceNo: "LEGACY-STOCK",
            supplierName: item.supplierName || "",
            buyingPrice: Number(item.buyingPrice || 0),
            quantity: left
        });
    }

    return allocations;
}


/* =========================================================
   ISSUE
========================================================= */

$("outForm").onsubmit =
    async event => {

        event.preventDefault();


        const item =
            items.find(
                current =>
                    current.id ===
                    $("outItem").value
            );


        if (!item)
            return;


        const quantity =
            Number(
                $("outQty").value
            );


        if (
            quantity >
            Number(item.stockQty || 0)
        ) {

            alert(
                "Insufficient stock."
            );

            return;
        }


        const pcsPerUnit =
            Number(
                item.pcsPerUnit || 1
            );


        const fifoAllocations =
            await allocateFifoBatches(
                item,
                quantity
            );


        await addDoc(
            collection(
                db,
                "stockOut"
            ),
            {

                itemNo:
                    item.itemNo,

                itemName:
                    item.itemName,

                quantity,

                unit:
                    item.unitType ||
                    item.unit ||
                    "",

                unitType:
                    item.unitType ||
                    null,

                pcsPerUnit,

                totalPcsOut:
                    quantity *
                    pcsPerUnit,

                reason:
                    $("reason").value,

                jobNo:
                    $("jobNo").value,

                issuedTo:
                    $("issuedTo").value,

                fifoAllocations,

                issuedBy:
                    user.email,

                issuedDate:
                    serverTimestamp(),

                createdAt:
                    serverTimestamp()
            }
        );


        const newQuantity =
            Number(
                item.stockQty || 0
            )
            -
            quantity;


        await updateDoc(
            doc(
                db,
                "items",
                item.id
            ),
            {

                stockQty:
                    newQuantity,

                totalPcs:
                    newQuantity *
                    pcsPerUnit
            }
        );


        event.target.reset();

        await refresh();

        alert(
            "Issue saved successfully."
        );
    };


/* =========================================================
   HISTORY
========================================================= */

function renderHistory() {

    const search =
        $("hsearch")
            .value
            .toLowerCase();


    const type =
        $("htype").value;


    const filtered =
        history.filter(
            record => {

                // Hide system/admin activity logs from stock History.
                // Backup exports remain in activityLogs but are not shown as Issue rows.
                if (record.type === "ACTIVITY")
                    return false;

                const correctType =
                    type === "All" ||
                    record.type === type;


                const correctSearch = [

                    record.itemNo,
                    record.itemName,
                    record.jobNo,
                    record.invoiceNo,
                    record.issuedTo,
                    record.supplierName,
                    record.action,
                    record.reference,
                    record.issuedBy,
                    record.enteredBy,
                    record.updatedBy,
                    record.performedBy

                ].some(
                    value =>
                        String(
                            value || ""
                        )
                            .toLowerCase()
                            .includes(search)
                );


                return (
                    correctType &&
                    correctSearch
                );
            }
        );


    $("historyRows").innerHTML =
        filtered
            .map(
                record => `
                    <tr>

                        <td>
                            ${
                                ms(record.createdAt)
                                    ?
                                    new Date(
                                        ms(record.createdAt)
                                    )
                                        .toLocaleString(
                                            "en-GB"
                                        )
                                    :
                                    "-"
                            }
                        </td>

                        <td>
                            ${
                                record.type === "IN"
                                    ?
                                    "Receiving"
                                    :
                                    "Issue"
                            }
                        </td>

                        <td>
                            ${esc(record.itemNo)}
                        </td>

                        <td>
                            ${esc(record.itemName)}
                        </td>

                        <td>
                            ${record.quantity || 0}
                        </td>

                        <td>
                            ${esc(
                                record.jobNo ||
                                record.invoiceNo ||
                                "-"
                            )}
                        </td>

                        <td>
                            ${esc(
                                record.issuedBy ||
                                record.enteredBy ||
                                "-"
                            )}
                        </td>

                    </tr>
                `
            )
            .join("");
}


$("hsearch").oninput =
    renderHistory;


$("htype").onchange =
    renderHistory;


/* =========================================================
   SUPPLIERS
========================================================= */

function renderSuppliers() {

    $("supplierRows").innerHTML =
        suppliers
            .map(
                supplier => `
                    <tr>

                        <td>
                            ${esc(
                                supplier.companyName
                            )}
                        </td>

                        <td>
                            ${esc(
                                supplier.contactPerson
                            )}
                        </td>

                        <td>
                            ${esc(
                                supplier.phone
                            )}
                        </td>

                        <td>
                            ${esc(
                                supplier.email
                            )}
                        </td>

                        <td>
                            ${esc(
                                supplier.address
                            )}
                        </td>

                    </tr>
                `
            )
            .join("");
}


/* =========================================================
   MODAL
========================================================= */

function openModal(html) {

    $("modalBody").innerHTML =
        html;

    $("modal")
        .classList
        .remove("hidden");
}


$("close").onclick =
    () =>
        $("modal")
            .classList
            .add("hidden");


/* =========================================================
   ADD / EDIT ITEM
========================================================= */

$("addItem").onclick =
    () => itemModal();


function itemModal(item = null) {

    if (!isAdmin()) {
        alert("You do not have permission to add or edit items.");
        return;
    }

    const supplierOptions =

        `<option value="">
            Select Supplier
        </option>`

        +

        suppliers
            .filter(
                supplier =>
                    supplier.active !== false
            )
            .map(
                supplier => `
                    <option
                        value="${esc(
                            supplier.companyName
                        )}"
                    >
                        ${esc(
                            supplier.companyName
                        )}
                    </option>
                `
            )
            .join("");


    openModal(`

        <h3>
            ${item ? "Edit" : "Add"} Item
        </h3>


        <form
            id="itemForm"
            class="itemgrid"
        >


            <label>

                Item No

                <input
                    id="iNo"
                    placeholder="Example: INK001"
                    required
                    value="${esc(
                        item?.itemNo || ""
                    )}"
                >

            </label>


            <label>

                Item Name

                <input
                    id="iName"
                    required
                    value="${esc(
                        item?.itemName || ""
                    )}"
                >

            </label>


            <label class="full">

                Description

                <textarea
                    id="iDesc"
                    rows="3"
                >${esc(
                    item?.description || ""
                )}</textarea>

            </label>


            <label class="full">

                Specification

                <textarea
                    id="iSpec"
                    rows="3"
                    placeholder="Size / Type / Material / Other specification"
                >${esc(
                    item?.specification || ""
                )}</textarea>

            </label>


            <label>

                Location / Rack

                <input
                    id="iLoc"
                    placeholder="Example: A1"
                    value="${esc(
                        item?.location || ""
                    )}"
                >

            </label>


            <label>

                Unit

                <select id="iUnit">

                    <option>PCS</option>
                    <option>ROLL</option>
                    <option>KG</option>
                    <option>L</option>
                    <option>M</option>
                    <option>BOX</option>
                    <option>SET</option>

                </select>

            </label>


            <label>

                PCS per Unit

                <input
                    id="iPcs"
                    type="number"
                    step=".001"
                    value="${
                        item?.pcsPerUnit || 1
                    }"
                >

            </label>


            <label>

                Opening / Current Stock

                <input
                    id="iStock"
                    type="number"
                    step=".001"
                    ${item ? "readonly" : ""}
                    value="${
                        item?.stockQty || 0
                    }"
                >

            </label>


            <label>

                Minimum Quantity

                <input
                    id="iMin"
                    type="number"
                    step=".001"
                    required
                    value="${
                        item?.minimumQty || 0
                    }"
                >

            </label>


            <label>

                Supplier

                <select id="iSupplier">

                    ${supplierOptions}

                </select>

            </label>


            <label>

                Invoice No

                <input
                    id="iInvoice"
                    placeholder="Supplier Invoice No"
                    value="${esc(item?.invoiceNo || "")}"
                >

            </label>


            <label>

                Buying Price

                <input
                    id="iPrice"
                    type="number"
                    step=".01"
                    required
                    value="${
                        item?.buyingPrice || 0
                    }"
                >

            </label>


            <label>

                Expiry Date

                <input
                    id="iExp"
                    type="date"
                    value="${
                        item?.expiryDate
                            ?
                            new Date(
                                ms(
                                    item.expiryDate
                                )
                            )
                                .toISOString()
                                .slice(0, 10)
                            :
                            ""
                    }"
                >

            </label>


            <label>

                Barcode

                <input
                    id="iBar"
                    value="${esc(
                        item?.barcode || ""
                    )}"
                >

            </label>


            <label class="full">

                Image URL

                <input
                    id="iImg"
                    value="${esc(
                        item?.imageUrl || ""
                    )}"
                >

            </label>


            <button
                class="full"
                type="submit"
            >
                ${
                    item
                        ?
                        "Update Item"
                        :
                        "Save Item"
                }
            </button>


        </form>
    `);


    $("iUnit").value =
        item?.unitType || "PCS";


    $("iSupplier").value =
        item?.supplierName || "";


    $("itemForm").onsubmit =
        async event => {

            event.preventDefault();


            const itemNo =
                $("iNo")
                    .value
                    .trim();


            /*
               Duplicate Item No check
            */

            const duplicate =
                items.find(
                    current =>
                        current.itemNo
                            ?.toLowerCase() ===
                        itemNo.toLowerCase()
                        &&
                        current.id !==
                        item?.id
                );


            if (duplicate) {

                alert(
                    "This Item No already exists."
                );

                return;
            }


            const data = {

                itemNo,

                itemName:
                    $("iName")
                        .value
                        .trim(),

                description:
                    $("iDesc")
                        .value
                        .trim(),

                specification:
                    $("iSpec")
                        .value
                        .trim(),

                location:
                    $("iLoc")
                        .value
                        .trim(),

                unitType:
                    $("iUnit").value,

                pcsPerUnit:
                    Number(
                        $("iPcs").value
                    ) || 1,

                stockQty:
                    Number(
                        $("iStock").value
                    ) || 0,

                minimumQty:
                    Number(
                        $("iMin").value
                    ) || 0,

                supplierName:
                    $("iSupplier").value,

                invoiceNo:
                    $("iInvoice").value.trim(),

                buyingPrice:
                    Number(
                        $("iPrice").value
                    ) || 0,

                expiryDate:
                    $("iExp").value
                        ?
                        new Date(
                            $("iExp").value +
                            "T00:00:00"
                        )
                        :
                        null,

                barcode:
                    $("iBar")
                        .value
                        .trim()
                    ||
                    itemNo,

                imageUrl:
                    $("iImg")
                        .value
                        .trim()
                    ||
                    "-",

                active:
                    item?.active !== false,

                totalPcs:
                    (
                        Number(
                            $("iStock").value
                        ) || 0
                    )
                    *
                    (
                        Number(
                            $("iPcs").value
                        ) || 1
                    ),

                updatedAt:
                    serverTimestamp(),

                updatedBy:
                    user?.email || "-"
            };


            if (item) {

                await updateDoc(
                    doc(
                        db,
                        "items",
                        item.id
                    ),
                    data
                );

            } else {

                data.createdAt =
                    serverTimestamp();


                await setDoc(
                    doc(
                        db,
                        "items",
                        itemNo
                    ),
                    data
                );

                const openingQty = Number($("iStock").value) || 0;

                if (openingQty > 0) {
                    await addDoc(
                        collection(db, "stockIn"),
                        {
                            itemNo,
                            itemName: data.itemName,
                            quantity: openingQty,
                            receivedQty: openingQty,
                            remainingQty: openingQty,
                            batchStatus: "OPEN",
                            unit: data.unitType || "",
                            unitType: data.unitType || null,
                            pcsPerUnit: Number(data.pcsPerUnit || 1),
                            buyingPrice: Number(data.buyingPrice || 0),
                            supplierName: data.supplierName || "",
                            invoiceNo: data.invoiceNo || "",
                            expiryDate: data.expiryDate || null,
                            source: "ADD_ITEM",
                            enteredBy: user.email,
                            createdAt: serverTimestamp()
                        }
                    );
                }
            }


            await logActivity(
                item ? "Item Edited" : "Item Added",
                { itemNo, itemName: data.itemName },
                item ? "ITEM-EDIT" : "ITEM-ADD"
            );

            $("modal")
                .classList
                .add("hidden");


            await refresh();
        };
}


/* =========================================================
   EDIT ITEM
========================================================= */

window.editItem =
    id => {

        if (!isAdmin()) {
            alert("You do not have permission to edit items.");
            return;
        }

        const item =
            items.find(
                current =>
                    current.id === id
            );

        if (item)
            itemModal(item);
    };


/* =========================================================
   BARCODE
========================================================= */

window.itemBarcode =
    id => {

        const item =
            items.find(
                current =>
                    current.id === id
            );


        if (!item)
            return;


        openModal(`

            <h3>
                ${esc(item.itemName)}
            </h3>

            <svg id="bc"></svg>

            <br><br>

            <button
                onclick="window.print()"
            >
                Print Barcode
            </button>

        `);


        JsBarcode(
            "#bc",
            item.barcode ||
            item.itemNo,
            {
                format: "CODE128",
                displayValue: true
            }
        );
    };


/* =========================================================
   MORE ITEM DETAILS
========================================================= */

window.moreItem =
    id => {

        const item =
            items.find(
                current =>
                    current.id === id
            );


        if (!item)
            return;


        const itemHistory =
            history
                .filter(
                    record =>
                        record.itemNo ===
                        item.itemNo
                )
                .sort(
                    (a, b) =>
                        ms(b.createdAt) -
                        ms(a.createdAt)
                );


        const movementRows =
            itemHistory
                .map(
                    record => `

                        <tr>

                            <td>

                                ${
                                    ms(record.createdAt)
                                        ?
                                        new Date(
                                            ms(
                                                record.createdAt
                                            )
                                        )
                                            .toLocaleString(
                                                "en-GB"
                                            )
                                        :
                                        "-"
                                }

                            </td>


                            <td>

                                ${
                                    record.type === "IN"
                                        ?
                                        "Receiving"
                                        :
                                        "Issue"
                                }

                            </td>


                            <td>

                                ${
                                    record.quantity ||
                                    0
                                }

                            </td>


                            <td>

                                ${esc(
                                    record.invoiceNo ||
                                    record.jobNo ||
                                    "-"
                                )}

                            </td>


                            <td>

                                ${esc(
                                    record.supplierName ||
                                    record.issuedTo ||
                                    "-"
                                )}

                            </td>


                            <td>

                                ${esc(
                                    record.enteredBy ||
                                    record.issuedBy ||
                                    "-"
                                )}

                            </td>

                        </tr>
                    `
                )
                .join("")
            ||
            `
                <tr>
                    <td colspan="6">
                        No movement history.
                    </td>
                </tr>
            `;


        openModal(`

            <h3>

                ${esc(item.itemNo)}
                —
                ${esc(item.itemName)}

            </h3>


            <div class="details">

                <p>
                    <b>Location:</b>
                    ${esc(
                        item.location || "-"
                    )}
                </p>

                <p>
                    <b>Unit:</b>
                    ${esc(
                        item.unitType ||
                        item.unit ||
                        "-"
                    )}
                </p>

                <p>
                    <b>PCS per Unit:</b>
                    ${Number(item.pcsPerUnit || 1)}
                </p>

                <p>
                    <b>Description:</b>
                    ${esc(
                        item.description || "-"
                    )}
                </p>

                <p>
                    <b>Specification:</b>
                    ${esc(
                        item.specification || "-"
                    )}
                </p>

                <p>
                    <b>Supplier:</b>
                    ${esc(
                        item.supplierName || "-"
                    )}
                </p>

                <p>
                    <b>Current Stock:</b>
                    ${item.stockQty || 0}
                </p>

                <p>
                    <b>Minimum:</b>
                    ${item.minimumQty || 0}
                </p>

                <p>
                    <b>Buying Price:</b>
                    ${money(
                        item.buyingPrice
                    )}
                </p>

            </div>


            <h4>
                Receiving / Invoice Batches
            </h4>

            <div class="table">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Invoice No</th>
                            <th>Supplier</th>
                            <th>Received Qty</th>
                            <th>Buying Price</th>
                            <th>Remaining Qty</th>
                            <th>Expiry</th>
                            <th>Edit</th>
                            <th>Expired Stock</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${
                            itemHistory
                                .filter(record => record.type === "IN")
                                .sort((a,b) => ms(a.createdAt) - ms(b.createdAt))
                                .map(record => `
                                    <tr>
                                        <td>${ms(record.createdAt) ? new Date(ms(record.createdAt)).toLocaleString("en-GB") : "-"}</td>
                                        <td>${esc(record.invoiceNo || "-")}</td>
                                        <td>${esc(record.supplierName || "-")}</td>
                                        <td>${Number(record.receivedQty ?? record.quantity ?? 0)}</td>
                                        <td>${money(record.buyingPrice)}</td>
                                        <td><b>${Number(record.remainingQty ?? record.quantity ?? 0)}</b></td>
                                        <td>${record.expiryDate ? new Date(ms(record.expiryDate)).toLocaleDateString("en-GB") : "-"}</td>
                                        <td>${isAdmin() ? `<button onclick="window.editReceivingBatch('${record.id}')">Edit</button>` : "-"}</td>
                                        <td>
                                            ${
                                                record.expiryDate &&
                                                daysUntil(record.expiryDate) <= 30 &&
                                                Number(record.remainingQty ?? record.quantity ?? 0) > 0
                                                    ? `<button onclick="window.removeExpiredBatchStock('${record.id}', '${item.id}')">Remove Expiry Stock</button>`
                                                    : Number(record.remainingQty ?? record.quantity ?? 0) <= 0 &&
                                                      record.batchStatus === "EXPIRED_REMOVED"
                                                        ? `<b>Removed</b>`
                                                        : "-"
                                            }
                                        </td>
                                    </tr>
                                `).join("")
                            ||
                            (
                                Number(item.stockQty || 0) > 0
                                    ? `
                                        <tr>
                                            <td>-</td>
                                            <td>LEGACY-STOCK</td>
                                            <td>${esc(item.supplierName || "-")}</td>
                                            <td>${Number(item.stockQty || 0)}</td>
                                            <td>${money(item.buyingPrice)}</td>
                                            <td><b>${Number(item.stockQty || 0)}</b></td>
                                            <td>${item.expiryDate ? new Date(ms(item.expiryDate)).toLocaleDateString("en-GB") : "-"}</td>
                                            <td>-</td>
                                            <td>
                                                ${
                                                    item.expiryDate && daysUntil(item.expiryDate) <= 30
                                                        ? `<button onclick="window.removeLegacyExpiryStock('${item.id}')">Remove Expiry Stock</button>`
                                                        : "-"
                                                }
                                            </td>
                                        </tr>
                                    `
                                    : `<tr><td colspan="9">No invoice / receiving batches recorded.</td></tr>`
                            )
                        }
                    </tbody>
                </table>
            </div>

            <h4>
                Item Movement History
            </h4>


            <div class="table">

                <table>

                    <thead>

                        <tr>

                            <th>Date</th>

                            <th>Type</th>

                            <th>Qty</th>

                            <th>
                                Invoice / Job
                            </th>

                            <th>
                                Supplier / Customer
                            </th>

                            <th>By</th>

                        </tr>

                    </thead>


                    <tbody>

                        ${movementRows}

                    </tbody>

                </table>

            </div>
        `);
    };




/* =========================================================
   REMOVE LEGACY EXPIRY STOCK
========================================================= */

window.removeLegacyExpiryStock = async itemId => {
    const item = items.find(current => current.id === itemId);
    if (!item) return;

    const quantity = Number(item.stockQty || 0);
    if (quantity <= 0) {
        alert("This item has no stock to remove.");
        return;
    }

    if (!item.expiryDate || daysUntil(item.expiryDate) > 30) {
        alert("This stock is not expired or within 30 days of expiry.");
        return;
    }

    if (!confirm(
        `Remove ${quantity} expiry stock from LEGACY-STOCK?\n\n` +
        `Current Stock will become 0 and a History record will be kept.`
    )) return;

    await updateDoc(doc(db, "items", item.id), {
        stockQty: 0,
        totalPcs: 0,
        expiryDate: null,
        updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "stockOut"), {
        itemNo: item.itemNo,
        itemName: item.itemName,
        quantity,
        unit: item.unitType || item.unit || "",
        unitType: item.unitType || null,
        pcsPerUnit: Number(item.pcsPerUnit || 1),
        totalPcsOut: quantity * Number(item.pcsPerUnit || 1),
        reason: "Expiry Stock Removal",
        jobNo: "LEGACY-STOCK",
        issuedTo: "Expiry Stock Removal",
        fifoAllocations: [{
            stockInId: "",
            invoiceNo: "LEGACY-STOCK",
            supplierName: item.supplierName || "",
            buyingPrice: Number(item.buyingPrice || 0),
            quantity
        }],
        issuedBy: user?.email || "",
        issuedDate: serverTimestamp(),
        createdAt: serverTimestamp()
    });

    $("modal").classList.add("hidden");
    await refresh();
    alert("Legacy expiry stock removed successfully.");
};


/* =========================================================
   REMOVE EXPIRED BATCH STOCK
========================================================= */

window.removeExpiredBatchStock =
    async (batchId, itemId) => {

        const batch =
            history.find(
                record =>
                    record.type === "IN" &&
                    record.id === batchId
            );

        const item =
            items.find(
                current =>
                    current.id === itemId
            );

        if (!batch || !item) {
            alert("Expired batch or item not found.");
            return;
        }

        const remainingQty =
            Number(
                batch.remainingQty ??
                batch.quantity ??
                0
            );

        if (remainingQty <= 0) {
            alert("This batch has no remaining stock.");
            return;
        }

        if (
            !batch.expiryDate ||
            daysUntil(batch.expiryDate) > 30
        ) {
            alert("This button is available only for expired stock or stock expiring within 30 days.");
            return;
        }

        const confirmed =
            confirm(
                `Remove ${remainingQty} expired stock from invoice ${batch.invoiceNo || "-"}?\n\n` +
                `This will reduce Current Stock and keep the invoice record for history.`
            );

        if (!confirmed)
            return;

        const currentStock =
            Number(item.stockQty || 0);

        if (remainingQty > currentStock) {
            alert(
                "The expired batch remaining quantity is greater than the item's current stock. " +
                "Please check the stock records before removing it."
            );
            return;
        }

        const newQuantity =
            currentStock - remainingQty;

        const nextActiveBatch =
            history
                .filter(
                    record =>
                        record.type === "IN" &&
                        record.itemNo === item.itemNo &&
                        record.id !== batch.id &&
                        Number(record.remainingQty ?? record.quantity ?? 0) > 0 &&
                        record.expiryDate
                )
                .sort(
                    (a, b) =>
                        ms(a.expiryDate) -
                        ms(b.expiryDate)
                )[0] || null;

        await updateDoc(
            doc(db, "stockIn", batch.id),
            {
                remainingQty: 0,
                batchStatus: "EXPIRED_REMOVED",
                expiredRemovedQty: remainingQty,
                expiredRemovedAt: serverTimestamp(),
                expiredRemovedBy: user?.email || ""
            }
        );

        await updateDoc(
            doc(db, "items", item.id),
            {
                stockQty: newQuantity,
                totalPcs:
                    newQuantity *
                    Number(item.pcsPerUnit || 1),
                expiryDate:
                    nextActiveBatch
                        ? nextActiveBatch.expiryDate
                        : null,
                updatedAt: serverTimestamp()
            }
        );

        await addDoc(
            collection(db, "stockOut"),
            {
                itemNo: item.itemNo,
                itemName: item.itemName,
                quantity: remainingQty,
                unit:
                    item.unitType ||
                    item.unit ||
                    "",
                unitType:
                    item.unitType ||
                    null,
                pcsPerUnit:
                    Number(item.pcsPerUnit || 1),
                totalPcsOut:
                    remainingQty *
                    Number(item.pcsPerUnit || 1),
                reason: "Expired Stock",
                jobNo:
                    batch.invoiceNo
                        ? `EXP-${batch.invoiceNo}`
                        : "EXPIRED-STOCK",
                issuedTo: "Expired Stock Removal",
                fifoAllocations: [
                    {
                        stockInId: batch.id,
                        invoiceNo: batch.invoiceNo || "",
                        supplierName: batch.supplierName || "",
                        buyingPrice: Number(batch.buyingPrice || 0),
                        quantity: remainingQty
                    }
                ],
                expiredBatchId: batch.id,
                expiredInvoiceNo: batch.invoiceNo || "",
                issuedBy: user?.email || "",
                issuedDate: serverTimestamp(),
                createdAt: serverTimestamp()
            }
        );

        $("modal")
            .classList
            .add("hidden");

        await refresh();

        alert(
            "Expired stock removed successfully. The invoice batch was kept in history with Remaining Qty = 0."
        );
    };


/* =========================================================
   EDIT RECEIVING / INVOICE BATCH
========================================================= */

window.editReceivingBatch =
    async id => {

        if (!isAdmin()) {
            alert("You do not have permission to edit receiving batches.");
            return;
        }

        const batch =
            history.find(
                record =>
                    record.type === "IN" &&
                    record.id === id
            );

        if (!batch) {
            alert("Receiving batch not found.");
            return;
        }

        const supplierOptions =
            `<option value="">Select Supplier</option>` +
            suppliers
                .filter(supplier => supplier.active !== false)
                .map(supplier => `
                    <option value="${esc(supplier.companyName)}">
                        ${esc(supplier.companyName)}
                    </option>
                `)
                .join("");

        const expiryValue =
            batch.expiryDate
                ? new Date(ms(batch.expiryDate))
                    .toISOString()
                    .slice(0, 10)
                : "";

        openModal(`
            <h3>Edit Receiving / Invoice Batch</h3>

            <form id="batchEditForm" class="itemgrid">

                <label>
                    Invoice No
                    <input
                        id="batchInvoice"
                        value="${esc(batch.invoiceNo || "")}"
                    >
                </label>

                <label>
                    Supplier
                    <select id="batchSupplier">
                        ${supplierOptions}
                    </select>
                </label>

                <label>
                    Buying Price
                    <input
                        id="batchPrice"
                        type="number"
                        step=".01"
                        min="0"
                        value="${Number(batch.buyingPrice || 0)}"
                        required
                    >
                </label>

                <label>
                    Expiry Date
                    <input
                        id="batchExpiry"
                        type="date"
                        value="${expiryValue}"
                    >
                </label>

                <label>
                    Received Qty
                    <input
                        value="${Number(batch.receivedQty ?? batch.quantity ?? 0)}"
                        readonly
                    >
                </label>

                <label>
                    Remaining Qty
                    <input
                        value="${Number(batch.remainingQty ?? batch.quantity ?? 0)}"
                        readonly
                    >
                </label>

                <button class="full" type="submit">
                    Save Batch Changes
                </button>
            </form>
        `);

        $("batchSupplier").value =
            batch.supplierName || "";

        $("batchEditForm").onsubmit =
            async event => {

                event.preventDefault();

                const invoiceNo =
                    $("batchInvoice").value.trim();

                const supplierName =
                    $("batchSupplier").value;

                const buyingPrice =
                    Number($("batchPrice").value) || 0;

                const expiryDate =
                    $("batchExpiry").value
                        ? new Date(
                            $("batchExpiry").value +
                            "T00:00:00"
                        )
                        : null;

                await updateDoc(
                    doc(db, "stockIn", batch.id),
                    {
                        invoiceNo,
                        supplierName,
                        buyingPrice,
                        expiryDate,
                        updatedAt: serverTimestamp(),
                        updatedBy: user?.email || ""
                    }
                );

                $("modal")
                    .classList
                    .add("hidden");

                await refresh();

                alert(
                    "Invoice batch updated successfully. Received Qty and Remaining Qty were not changed."
                );
            };
    };


/* =========================================================
   ADD SUPPLIER
========================================================= */

$("addSupplier").onclick =
    () => supplierModal();


function supplierModal() {

    openModal(`

        <h3>
            Add Supplier
        </h3>

        <form
            id="supplierForm"
            class="itemgrid"
        >

            <input
                id="supplierCompany"
                class="full"
                placeholder="Company Name"
                required
            >

            <input
                id="supplierContact"
                placeholder="Contact Person"
            >

            <input
                id="supplierPhone"
                placeholder="Phone"
            >

            <input
                id="supplierEmail"
                placeholder="Email"
            >

            <input
                id="supplierAddress"
                class="full"
                placeholder="Address"
            >

            <button class="full">
                Save Supplier
            </button>

        </form>
    `);


    $("supplierForm").onsubmit =
        async event => {

            event.preventDefault();


            await addDoc(
                collection(
                    db,
                    "suppliers"
                ),
                {

                    companyName:
                        $("supplierCompany")
                            .value
                            .trim(),

                    contactPerson:
                        $("supplierContact")
                            .value
                            .trim(),

                    phone:
                        $("supplierPhone")
                            .value
                            .trim(),

                    email:
                        $("supplierEmail")
                            .value
                            .trim(),

                    address:
                        $("supplierAddress")
                            .value
                            .trim(),

                    active:
                        true,

                    createdAt:
                        serverTimestamp()
                }
            );


            $("modal")
                .classList
                .add("hidden");


            await refresh();
        };
}

/* =========================================================
   MOBILE / PWA
========================================================= */

const mobileMenuButton = $("mobileMenu");
const sidebar = document.querySelector("aside");

if (mobileMenuButton && sidebar) {
    mobileMenuButton.addEventListener("click", () => {
        sidebar.classList.toggle("mobile-open");
    });

    document
        .querySelectorAll("aside button[data-page]")
        .forEach(button => {
            button.addEventListener("click", () => {
                if (window.innerWidth <= 800)
                    sidebar.classList.remove("mobile-open");
            });
        });
}

let deferredInstallPrompt = null;
const installAppButton = $("installApp");

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;

    if (installAppButton)
        installAppButton.classList.remove("hidden");
});

if (installAppButton) {
    installAppButton.addEventListener("click", async () => {
        if (!deferredInstallPrompt)
            return;

        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;

        deferredInstallPrompt = null;
        installAppButton.classList.add("hidden");
    });
}

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;

    if (installAppButton)
        installAppButton.classList.add("hidden");
});

const sidebarInstallAppBtn = $("sidebarInstallApp");
if (sidebarInstallAppBtn) {
  sidebarInstallAppBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
}
