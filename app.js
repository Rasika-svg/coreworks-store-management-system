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

    $("nVal").textContent =
        money(stockValue);

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

    renderStockValueSelector(stockValue);
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

                            <button
                                onclick="window.editItem('${item.id}')"
                            >
                                Edit
                            </button>

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
   BARCODE SEARCH - ISSUE
========================================================= */

$("barcode").onchange = () => {

    const search =
        $("barcode")
            .value
            .trim()
            .toLowerCase();


    const item =
        items.find(
            current =>
                String(
                    current.itemNo || ""
                ).toLowerCase() === search
                ||
                String(
                    current.barcode || ""
                ).toLowerCase() === search
        );


    if (item)
        $("outItem").value =
            item.id;
};


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

                const correctType =
                    type === "All" ||
                    record.type === type;


                const correctSearch = [

                    record.itemNo,
                    record.itemName,
                    record.jobNo,
                    record.invoiceNo,
                    record.issuedTo,
                    record.supplierName

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
                    serverTimestamp()
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
                                        <td><button onclick="window.editReceivingBatch('${record.id}')">Edit</button></td>
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