# Coreworks Store Management System
Company: Coreworks Trading (Pvt) Ltd.

Starter web application for Firebase Authentication + Firestore + GitHub Pages.
Collections used: items, suppliers, stockIn, stockOut, users.

The starter supports:
- Email/password login
- Dashboard alerts for minimum stock and expiry within 7 days
- Manual Item No
- Search by Item No, Item Name and Description
- Unit types PCS / ROLL / KG / L / M / BOX / SET
- PCS-per-unit (e.g. 1 Roll = 1000 or 5000 PCS)
- Buying price, supplier, expiry, rack/location and image URL
- CODE128 barcode generation
- Stock IN and Stock OUT with transaction history

Note: Firebase Storage is not enabled on the current Spark plan, so the image field currently accepts an image URL. A Cloudinary upload integration can be added next.
