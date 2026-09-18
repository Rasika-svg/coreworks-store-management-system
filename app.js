import{initializeApp}from"https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import{getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut}from"https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import{getFirestore,collection,getDocs,doc,setDoc,addDoc,updateDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
const firebaseConfig = {
  apiKey: "AIzaSyDXHA-l-TqWGijVXDoOk5nGw0YFrgzM5yA",
  authDomain: "coreworks-store.firebaseapp.com",
  projectId: "coreworks-store",
  storageBucket: "coreworks-store.firebasestorage.app",
  messagingSenderId: "661100888687",
  appId: "1:661100888687:web:b94d01928ef5e82c13039a"
};
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);let user,items=[],suppliers=[],history=[];
const $=x=>document.getElementById(x), esc=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])),ms=x=>x?.toMillis?x.toMillis():x?.seconds?x.seconds*1000:new Date(x||0).getTime(),money=x=>"Rs. "+Number(x||0).toLocaleString("en-LK",{minimumFractionDigits:2}),days=x=>Math.ceil((ms(x)-Date.now())/86400000);
onAuthStateChanged(auth,async u=>{user=u;if(u){$("loginView").classList.add("hidden");$("app").classList.remove("hidden");$("user").textContent=u.email;await refresh()}else{$("app").classList.add("hidden");$("loginView").classList.remove("hidden")}});
$("loginForm").onsubmit=async e=>{e.preventDefault();try{await signInWithEmailAndPassword(auth,$("email").value,$("password").value)}catch(x){$("error").textContent=x.message}};$("logout").onclick=()=>signOut(auth);$("refresh").onclick=refresh;
document.querySelectorAll("aside button[data-page]").forEach(b=>b.onclick=()=>{document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$(b.dataset.page).classList.remove("hidden");$("title").textContent=b.textContent.trim()});
async function all(n){return(await getDocs(collection(db,n))).docs.map(d=>({id:d.id,...d.data()}))}
async function refresh(){try{items=await all("items");suppliers=await all("suppliers");history=[...(await all("stockIn")).map(x=>({...x,type:"IN"})),...(await all("stockOut")).map(x=>({...x,type:"OUT"}))].sort((a,b)=>ms(b.createdAt)-ms(a.createdAt));dashboard();renderItems();selects();renderSuppliers();renderHistory()}catch(e){alert(e.message)}}
function dashboard(){let low=items.filter(x=>Number(x.stockQty||0)<=Number(x.minimumQty||0)),exp=items.filter(x=>x.expiryDate&&days(x.expiryDate)>=0&&days(x.expiryDate)<=7),val=items.reduce((s,x)=>s+Number(x.stockQty||0)*Number(x.buyingPrice||0),0);$("nItems").textContent=items.length;$("nLow").textContent=low.length;$("nExp").textContent=exp.length;$("nVal").textContent=money(val);$("low").innerHTML=low.map(x=>`<p>${esc(x.itemNo)} — ${esc(x.itemName)} | <b>${x.stockQty} / ${x.minimumQty}</b></p>`).join("")||"<p>No alerts.</p>";$("exp").innerHTML=exp.map(x=>`<p>${esc(x.itemNo)} — ${esc(x.itemName)} | <b>${days(x.expiryDate)} day(s)</b></p>`).join("")||"<p>No expiring items.</p>"}
function renderItems(){let q=$("search").value.toLowerCase(),d=items.filter(x=>[x.itemNo,x.itemName,x.description].some(v=>String(v||"").toLowerCase().includes(q)));$("itemRows").innerHTML=d.map(x=>`<tr><td>${x.imageUrl&&x.imageUrl!=="-"?`<img class="thumb" src="${esc(x.imageUrl)}">`:""}</td><td>${esc(x.itemNo)}</td><td>${esc(x.itemName)}</td><td>${esc(x.description)}</td><td>${esc(x.unitType||x.unit||"")}${x.pcsPerUnit?` (${x.pcsPerUnit} pcs/u)`:""}</td><td>${x.stockQty||0}</td><td>${x.minimumQty||0}</td><td>${money(x.buyingPrice)}</td><td>${x.expiryDate?new Date(ms(x.expiryDate)).toLocaleDateString("en-GB"):"-"}</td><td><button onclick="window.edit('${x.id}')">Edit</button> <button onclick="window.barcode('${x.id}')">Barcode</button></td></tr>`).join("")||"<tr><td colspan=10>No items found.</td></tr>"}
$("search").oninput=renderItems;
function selects(){let o=items.map(x=>`<option value="${x.id}">${esc(x.itemNo)} — ${esc(x.itemName)}</option>`).join("");$("inItem").innerHTML=o;$("outItem").innerHTML=o}
$("barcode").onchange=()=>{let q=$("barcode").value.trim().toLowerCase(),x=items.find(i=>String(i.itemNo||"").toLowerCase()===q||String(i.barcode||"").toLowerCase()===q);if(x)$("outItem").value=x.id};
$("inForm").onsubmit=async e=>{e.preventDefault();let x=items.find(i=>i.id===$("inItem").value),q=+$("inQty").value,p=+$("inPrice").value;if(!x)return;await addDoc(collection(db,"stockIn"),{itemNo:x.itemNo,itemName:x.itemName,quantity:q,unit:x.unitType||x.unit||"",unitType:x.unitType||null,pcsPerUnit:+(x.pcsPerUnit||1),buyingPrice:p,supplierName:$("inSupplier").value,invoiceNo:$("inInvoice").value,expiryDate:$("inExpiry").value?new Date($("inExpiry").value+"T00:00:00"):null,enteredBy:user.email,createdAt:serverTimestamp()});let nq=+(x.stockQty||0)+q;await updateDoc(doc(db,"items",x.id),{stockQty:nq,totalPcs:nq*+(x.pcsPerUnit||1),buyingPrice:p});e.target.reset();await refresh();alert("Stock IN saved.")};
$("outForm").onsubmit=async e=>{e.preventDefault();let x=items.find(i=>i.id===$("outItem").value),q=+$("outQty").value;if(!x)return;if(q>+(x.stockQty||0)){alert("Insufficient stock");return}let pcs=+(x.pcsPerUnit||1);await addDoc(collection(db,"stockOut"),{itemNo:x.itemNo,itemName:x.itemName,quantity:q,unit:x.unitType||x.unit||"",unitType:x.unitType||null,pcsPerUnit:pcs,totalPcsOut:q*pcs,reason:$("reason").value,jobNo:$("jobNo").value,issuedTo:$("issuedTo").value,issuedBy:user.email,issuedDate:serverTimestamp(),createdAt:serverTimestamp()});let nq=+(x.stockQty||0)-q;await updateDoc(doc(db,"items",x.id),{stockQty:nq,totalPcs:nq*pcs});e.target.reset();await refresh();alert("Stock OUT saved.")};
function renderHistory(){let q=$("hsearch").value.toLowerCase(),t=$("htype").value,d=history.filter(x=>(t==="All"||x.type===t)&&[x.itemNo,x.itemName,x.jobNo,x.invoiceNo].some(v=>String(v||"").toLowerCase().includes(q)));$("historyRows").innerHTML=d.map(x=>`<tr><td>${ms(x.createdAt)?new Date(ms(x.createdAt)).toLocaleString("en-GB"):"-"}</td><td>${x.type}</td><td>${esc(x.itemNo)}</td><td>${esc(x.itemName)}</td><td>${x.quantity||0}</td><td>${esc(x.jobNo||x.invoiceNo||"-")}</td><td>${esc(x.issuedBy||x.enteredBy||"-")}</td></tr>`).join("")}
$("hsearch").oninput=renderHistory;$("htype").onchange=renderHistory;function renderSuppliers(){$("supplierRows").innerHTML=suppliers.map(s=>`<tr><td>${esc(s.companyName)}</td><td>${esc(s.contactPerson)}</td><td>${esc(s.phone)}</td><td>${esc(s.email)}</td><td>${esc(s.address)}</td></tr>`).join("")}
$("addItem").onclick=()=>itemModal();$("addSupplier").onclick=()=>supplierModal();$("close").onclick=()=>$("modal").classList.add("hidden");
function open(h){$("modalBody").innerHTML=h;$("modal").classList.remove("hidden")}
function itemModal(x=null){
  let itemSuggestions = items
    .map(i => `<option value="${esc(i.itemNo)}">${esc(i.itemName)}</option>`)
    .join("");

  open(`
    <h3>${x ? "Edit" : "Add"} Item</h3>

    <form id="itemForm" class="itemgrid">

      <div>
        <label>Item No</label>
        <input
          id="iNo"
          list="itemNoList"
          placeholder="Enter Item No"
          required
          autocomplete="off"
          value="${esc(x?.itemNo)}"
        >
        <datalist id="itemNoList">
          ${itemSuggestions}
        </datalist>
      </div>

      <div>
        <label>Item Name</label>
        <input
          id="iName"
          placeholder="Enter Item Name"
          required
          value="${esc(x?.itemName)}"
        >
      </div>

      <div class="full">
        <label>Description</label>
        <textarea
          id="iDesc"
          placeholder="Enter Item Description"
        >${esc(x?.description)}</textarea>
      </div>

      <div>
        <label>Unit</label>
        <select id="iUnit">
          <option>PCS</option>
          <option>ROLL</option>
          <option>KG</option>
          <option>L</option>
          <option>M</option>
          <option>BOX</option>
          <option>SET</option>
        </select>
      </div>

      <div>
        <label>PCS per Unit</label>
        <input
          id="iPcs"
          type="number"
          step=".001"
          placeholder="Example: 1000"
          value="${x?.pcsPerUnit || 1}"
        >
      </div>

      <div>
        <label>Opening Stock</label>
        <input
          id="iStock"
          type="number"
          step=".001"
          placeholder="Example: 10"
          value="${x?.stockQty || 0}"
        >
      </div>

      <div>
        <label>Minimum Stock Alert</label>
        <input
          id="iMin"
          type="number"
          step=".001"
          placeholder="Example: 2"
          value="${x?.minimumQty || 0}"
          required
        >
      </div>

      <div>
        <label>Buying Price</label>
        <input
          id="iPrice"
          type="number"
          step=".01"
          placeholder="Example: 2498"
          value="${x?.buyingPrice || 0}"
          required
        >
      </div>

      <div>
        <label>Expiry Date</label>
        <input
          id="iExp"
          type="date"
          value="${x?.expiryDate
            ? new Date(ms(x.expiryDate)).toISOString().slice(0,10)
            : ""}"
        >
      </div>

      <div>
        <label>Supplier</label>
        <input
          id="iSupplier"
          placeholder="Enter Supplier"
          value="${esc(x?.supplierName)}"
        >
      </div>

      <div>
        <label>Location / Rack</label>
        <input
          id="iLoc"
          placeholder="Example: Rack A-01"
          value="${esc(x?.location)}"
        >
      </div>

      <div>
        <label>Barcode</label>
        <input
          id="iBar"
          placeholder="Enter Barcode"
          value="${esc(x?.barcode)}"
        >
      </div>

      <div class="full">
        <label>Image URL</label>
        <input
          id="iImg"
          placeholder="Image URL"
          value="${esc(x?.imageUrl)}"
        >
      </div>

      <button class="full">${x ? "Update Item" : "Save Item"}</button>

    </form>
  `);

  $("iUnit").value = x?.unitType || "PCS";

  // Item No type කරනකොට existing Item No suggestions
  $("iNo").addEventListener("input", () => {
    let value = $("iNo").value.trim().toLowerCase();

    let found = items.find(i =>
      String(i.itemNo || "").toLowerCase() === value
    );

    // Existing Item No එකක් select/type කළොත් details auto-fill
    if(found && !x){

      $("iName").value = found.itemName || "";
      $("iDesc").value = found.description || "";
      $("iUnit").value = found.unitType || "PCS";
      $("iPcs").value = found.pcsPerUnit || 1;
      $("iMin").value = found.minimumQty || 0;
      $("iPrice").value = found.buyingPrice || 0;
      $("iSupplier").value = found.supplierName || "";
      $("iLoc").value = found.location || "";
      $("iBar").value = found.barcode || found.itemNo || "";
      $("iImg").value = found.imageUrl || "-";
    }
  });

  $("itemForm").onsubmit = async e => {
    e.preventDefault();

    let itemNo = $("iNo").value.trim();

    // Duplicate Item No check
    let duplicate = items.find(i =>
      String(i.itemNo || "").toLowerCase() === itemNo.toLowerCase()
      && i.id !== x?.id
    );

    if(duplicate){
      alert(
        "This Item No already exists.\n\n" +
        duplicate.itemNo + " — " +
        duplicate.itemName
      );
      $("iNo").focus();
      return;
    }

    let d = {
      itemNo: itemNo,
      itemName: $("iName").value.trim(),
      description: $("iDesc").value.trim(),
      unitType: $("iUnit").value,
      pcsPerUnit: +$("iPcs").value || 1,
      stockQty: +$("iStock").value || 0,
      minimumQty: +$("iMin").value || 0,
      buyingPrice: +$("iPrice").value || 0,

      expiryDate: $("iExp").value
        ? new Date($("iExp").value + "T00:00:00")
        : null,

      supplierName: $("iSupplier").value.trim(),
      location: $("iLoc").value.trim(),

      barcode:
        $("iBar").value.trim() ||
        itemNo,

      imageUrl:
        $("iImg").value.trim() ||
        "-",

      active: x?.active !== false,

      totalPcs:
        (+$("iStock").value || 0) *
        (+$("iPcs").value || 1),

      updatedAt: serverTimestamp()
    };

    if(x){
      await updateDoc(
        doc(db,"items",x.id),
        d
      );
    }else{
      d.createdAt = serverTimestamp();

      await setDoc(
        doc(db,"items",itemNo),
        d
      );
    }

    $("modal").classList.add("hidden");

    await refresh();
  };
}
window.edit=id=>itemModal(items.find(x=>x.id===id));window.barcode=id=>{let x=items.find(i=>i.id===id);open(`<h3>${esc(x.itemName)}</h3><svg id="bc"></svg><button onclick="print()">Print Barcode</button>`);JsBarcode("#bc",x.barcode||x.itemNo,{format:"CODE128",displayValue:true})};
function supplierModal(){open(`<h3>Add Supplier</h3><form id="sf" class="itemgrid"><input id="sc" class="full" placeholder="Company Name" required><input id="sp" placeholder="Contact Person"><input id="st" placeholder="Phone"><input id="se" placeholder="Email"><input id="sa" class="full" placeholder="Address"><button class="full">Save</button></form>`);$("sf").onsubmit=async e=>{e.preventDefault();await addDoc(collection(db,"suppliers"),{companyName:$("sc").value,contactPerson:$("sp").value,phone:$("st").value,email:$("se").value,address:$("sa").value,active:true,createdAt:serverTimestamp()});$("modal").classList.add("hidden");await refresh()}}
