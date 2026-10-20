# Hardware recommendation

Optimas POS runs in Chrome/Edge on an ordinary Windows PC or touchscreen terminal. All the devices below use open standards (ESC/POS printing, RJ11 drawer kick, HID keyboard scanners), so the shop is never locked into one vendor.

> Prices are rough Nairobi retail ranges (2026) to help with budgeting. **Get current quotes** from local suppliers before buying.

## Recommended bundle (one till)

| # | Device | Recommended | Why | Approx. KES |
|---|---|---|---|---|
| 1 | **Touchscreen POS terminal** | 15" all-in-one POS PC (Intel Celeron J-series / i3, **8 GB RAM, 128 GB+ SSD**, Windows 10/11). A laptop or desktop with a mouse also works. | Large tap targets for greasy hands; the till is the computer | 45,000 – 80,000 |
| 2 | **Receipt printer, 80 mm** | **Epson TM-T20III (USB + Ethernet)**, or a budget option: **Xprinter XP-Q80 / XP-N160II (USB + LAN)** | Use the **LAN** model and *Settings → Hardware → Network*. No drivers, never "disconnects", and it can be shared by two tills | 8,000 – 30,000 |
| 3 | **Cash drawer** | Any 5-note / 8-coin drawer with an **RJ11 (printer-driven, 24 V)** cable | Plugs into the printer; opens automatically on cash sales | 5,000 – 9,000 |
| 4 | **Barcode scanner** | **2D handheld USB**, e.g. Zebra DS2208, Honeywell Voyager 1470g, or a budget Netum/Inateck | 2D reads damaged and small part labels and QR codes. Set to "USB keyboard" mode with an Enter suffix | 3,500 – 18,000 |
| 5 | **Label printer** *(recommended)* | Xprinter XP-365B / XP-420B or Zebra ZD220 (direct thermal, 40×30 mm labels) | Many spare parts arrive without barcodes. Print your own SKU labels to make scanning work | 8,000 – 30,000 |
| 6 | **UPS** | 650–1000 VA line-interactive | Power cuts must not corrupt a sale mid-print | 7,000 – 15,000 |
| 7 | **Card terminal** *(optional)* | Standalone bank PDQ (your bank / Pesapal / iPay) | Record card sales in the POS with the approval code; no integration needed | from bank |

**Indicative total:** about KES 75,000 – 180,000, depending on brands.

### Budget option

Use an existing laptop, an Xprinter XP-58IIH (58 mm USB, set paper width to 58 mm), a basic 1D USB scanner and an RJ11 drawer. Total is about **KES 15,000 – 25,000** on top of the laptop. All features still work.

### Why not an Android all-in-one (Sunmi, etc.)?

They are compact, but their built-in printers use vendor SDKs that a web app can't reach reliably. Data entry for inventory (CSV, long part names) is also much easier on Windows. If the shop later wants a handheld for stock-taking, any Android phone running Chrome can open the POS on the shop Wi-Fi.

## Setup

1. **Printer (LAN, recommended):** connect it to the router and print its self-test page (hold FEED while powering on) to read its IP address. Ideally reserve that IP in the router. In the POS: *Settings → Hardware → Network (LAN)*, enter the IP and port 9100, then press **Print test page**. The local server (`npm run server:start`) must be running.
2. **Printer (USB):** *Settings → Hardware → USB → Pair printer*. On Windows, WebUSB needs the printer bound to the **WinUSB** driver (use Zadig). Alternatively, install the vendor driver and use **Browser print**, which works with any driver but can't open the drawer.
3. **Bluetooth / USB-serial printer:** pair it in Windows first, then *Settings → Hardware → Serial / Bluetooth → Pair printer*.
4. **Cash drawer:** plug the RJ11 cable into the printer's "DK" port. Use **Test cash drawer**.
5. **Scanner:** plug it in. If scans don't add items, scan the manufacturer's "Add Enter/CR suffix" configuration code. On the Sell screen you can scan at any time; you don't need to click the search box first.
6. **Install as an app:** in Chrome, open the menu and choose *Install Optimas POS*. It then opens full-screen from the desktop like a native app.

## Suppliers

Luthuli Avenue / Moi Avenue (Nairobi CBD) POS hardware dealers, Jumia, and local Epson and Zebra resellers. Ask for a **warranty** and a **demo of LAN printing** before paying.
