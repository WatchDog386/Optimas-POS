# Hardware specification — Optimas POS

Optimas POS is a browser app (React + Tailwind) served by a small Node/Express server
(`server/index.ts`) that also acts as the printer relay and the M‑Pesa bridge. Shop data
lives in the browser's IndexedDB on the till machine, so **the till is the till** — if the
till dies, unsynced sales die with it.

This document is the complete purchase list: what to buy, the exact models, the exact
specification of the machine the software runs on, and how everything is wired.

> Prices are indicative Nairobi retail prices (web-checked Oct 2026), usually **ex‑VAT**.
> Stock and pricing move — **get written quotes before buying.**

---

## 1. The machine (this is the "where I install the system" box)

### 1.1 Hard requirements — do not deviate

These come from the code, not from preference. Buying outside these lines breaks features.

| Requirement | Value | Why (source) |
|---|---|---|
| OS | **Windows 11 Pro** (Win 10 Pro 22H2 acceptable) | Windows-only paths exist for the USB printer (Zadig/WinUSB) and COM pairing. `server/index.ts` uses `process.loadEnvFile()` (Node 20.6+) and `node:net`. |
| Browser | **Google Chrome or Microsoft Edge, current version** | `src/lib/printer.ts` needs `navigator.usb` (WebUSB) and `navigator.serial` (Web Serial). Firefox and Safari have neither → no raw printing. `src/main.tsx` registers a service worker for PWA install. |
| Node.js | **Node 22 LTS (≥ 22.12) or Node 24 LTS** | `better-sqlite3@13` declares `engines.node >= 22`; `vite@8` declares `^20.19.0 \|\| >=22.12.0`. Node 20 will refuse to install. |
| CPU | Intel N100 minimum; **i3 / N150 / i5 preferred** | Chrome + Node + SQLite + the whole catalogue in IndexedDB all share one box. |
| RAM | **8 GB minimum, 16 GB preferred** | The browser holds the full parts catalogue, sales history and stock ledger in memory. 4 GB runs out with a few thousand SKUs. |
| Storage | **256 GB SSD** (128 GB works but fills with Windows updates) | `node_modules` (~400 MB) + SQLite `data/optimas.db` + the Chrome profile + the IndexedDB store + Windows. |
| Panel | **15.6" 1920×1080 (FHD), 10-point capacitive touch** | `DESIGN.md` splits the UI at **1180 px**: below that the POS falls back to the compact tablet layout instead of the 8+4 column desktop till. Many 15" POS terminals ship **1024×768** — ask for the panel resolution explicitly. |
| Ports | **≥ 4 × USB‑A free, 1 × RJ45 gigabit, 1 × audio out, VGA or HDMI for a 2nd display** | Scanner + label printer + receipt printer (if USB) + PDQ need USB. The receipt printer and the till must sit on the same LAN. |
| Network | **Wired Ethernet on the shop LAN** | The printer relay (`server/index.ts:281-292`) refuses any address that is not a private IPv4 — the till, the server and the printer must share one LAN. |

**Do not buy a tablet or a phone as the till.** The inventory screen is a dense table with
CSV import/export and long part names; it is unusable on a 10" tablet.

### 1.2 Exact models to buy (till terminal)

**Option A — all-in-one touchscreen POS terminal (recommended). One box, everything included.**

| Model | Spec | KSh (approx.) | Notes |
|---|---|---|---|
| **MSI PRO AP162T ADL** (`PAP162TADL020`) | 15.6" FHD 10‑point touch, Intel N100, **RAM upgrade to 8 GB**, 128 GB SSD → 256 GB, Win 11 Pro, 2× COM, 6× USB | ~$608 (≈ KSh 78,000) | Best port count for a POS. Ask the reseller to fit 8 GB + 256 GB. |
| **Partner-tech SP-635-E1** | 15.6" PCAP touch, Intel Celeron J6412, 8 GB, 256 GB SSD, **Windows 11 IoT**, IP54 front, dual-display + VESA, USB 3.2 / LAN / 2× RS-232 / VGA / audio | **70,000** ex‑VAT | Best option if you want a customer-facing 2nd screen and a spill-proof panel. Confirm the panel is FHD (this family is sometimes 1024×768). |
| **X-POS T15** | 15" capacitive touch, Intel Celeron J1900, 4 GB (→8 GB), 128 GB (→256 GB), 6× USB, 2× COM, LAN, VGA | **60,000** ex‑VAT | Works, but the panel is **1024×768** → compact layout, and J1900 is slow. Only take this if the budget is fixed. |
| **Generic 15.6" N100 AIO (POS1528‑N100 / L200‑156 class)** | N100, **8 GB**, **256 GB NVMe**, 15.6" **1920×1080** 10‑point touch, Win 11 Pro, 4× USB2 + 4× USB3, 2× COM, RJ45 gigabit, HDMI, VGA, audio, VESA 100×100 | 45,000 – 70,000 | The sweet spot. **Insist on 8 GB / 256 GB / 1920×1080** — these are sold in several configurations and the 4 GB / 128 GB / 1024×768 version is the default. |
| **Beatsy `SKU-HW-POSAIO`** | 15.6" capacitive touch, Intel Core i5, 8 GB, 128 GB SSD, 6× USB, 2× COM, aluminium base | **45,000 – 48,000** | Cheapest good all-in-one. Upgrade the SSD to 256 GB. |

**Option B — mini PC + separate 15" touchscreen monitor (best value, most upgradeable).**

| Part | Model | KSh (approx.) |
|---|---|---|
| Mini PC | **Firebat AK2 PLUS** (N100, 8 GB, 256 GB) or **CHUWI HeroBox** (N100, 8 GB LPDDR5, 256 GB) or **GMKTEC N150** — pick one with **8 GB RAM and 256 GB SSD**, 1× RJ45, ≥ 4× USB | 32,000 – 38,000 |
| Monitor | 15.6" / 15" **FHD 1920×1080** **touchscreen** monitor with **VESA** mount (so the mini PC clamps behind it) and 1× HDMI + 1× VGA in/out | 18,000 – 30,000 |
| Keyboard/mouse | Wired, or a keyboard only if you use the touch UI for the catalogue | 1,500 – 3,000 |

> Why B is often the better deal: the mini PC's RAM and SSD are replaceable, so the till can be
> upgraded in 3 years without buying a new terminal. Pick **one that clones to USB** — a spare
> image of the configured till is your disaster-recovery plan.

**Option C — reuse what you already own.** Any existing Windows PC (i3/8 GB/SSD) + a 15" FHD
monitor works. Connect it with the LAN printer and you are done. The terminal only needs to
be *reachable*, not new.

### 1.3 Runtime software to install on the machine

Not hardware, but it is what makes the box work — include it in the installer's scope.

```
1. Windows 11 Pro, activated
2. Node.js 22 LTS (>= 22.12) — https://nodejs.org  (NOT 20.x, NOT 18.x)
3. Google Chrome (or Edge) — the ONLY supported browser
4. The Optimas POS repo + build:
       npm install          <-- full install, dev dependencies included
       npm run build        <-- builds dist/
       npm run server:start <-- serves the app + printer relay + M-Pesa on :8787
5. Open http://localhost:8787  and install it as an app (Chrome menu -> Install Optimas POS)
6. Run the server as a service (pm2 on Linux, or NSSM/Task Scheduler on Windows)
```

Two install traps:

- **`npm install`, not `npm install --omit=dev`.** `package.json` runs the server with
  `tsx server/index.ts` and `tsx` is a devDependency. Omit dev deps and the server will not start.
- **`better-sqlite3` is a native module.** It ships prebuilt binaries for Windows x64 +
  Node 22/24, so no compiler is needed on a normal machine. If `npm install` fails with
  "Could not locate the bindings file", install **Microsoft Visual Studio Build Tools 2022**
  (Desktop C++ workload) and reinstall.

> **Always install from `http://localhost:8787`, not from `http://192.168.x.x:8787`.**
> WebUSB, Web Serial and service-worker PWA install all require a *secure context*. Chrome
> treats `localhost` as secure; a LAN IP over plain HTTP is not. If you use the LAN URL, you
> lose USB/serial printing and PWA install until you put the shop behind HTTPS.

---

## 2. Peripherals

### 2.1 Receipt printer (80 mm, ESC/POS, LAN + USB)

| Model | KSh (approx.) | Why this one |
|---|---|---|
| **Xprinter XP-Q851L** | **6,500 – 8,700** (Jumia 5,650 / Phinetech 7,500 ex‑VAT / Lansotech 6,500 ex‑VAT) | ESC/POS, 80 mm, 230 mm/s, 203 dpi, 64 KB buffer, partial auto cutter (1.5 M cuts), **USB + LAN**, 230 V adapter, **DK drawer port rated DC 24 V / 1 A**. |
| Xprinter XP-Q80B | ~7,000 | Same family, USB + LAN. |
| Epson TM-T20III (USB + Ethernet) | ~23,000 | The name-brand option. Buy this if the shop wants Epson's paper supply and warranty network. |
| Xprinter XP-Q801K (**USB only**) | 5,500 | **Do not buy for the LAN plan** — no Ethernet socket. Fine only for the browser-print/USB path. |
| Xprinter XP-Q838L (USB + Bluetooth) | 12,000 | Bluetooth path → uses Web Serial, not LAN. |

**Requirements to put in the purchase order:** 80 mm (79.5 ± 0.5 mm) roll, ESC/POS command
set, **both USB and Ethernet**, auto cutter, **RJ11 "DK" cash-drawer output**, 230 V adapter
included, spare roll of 80×80 mm paper.

> Keep the shop name in plain ASCII. The ESC/POS encoder in `src/lib/escpos.ts` drops
> anything outside printable ASCII, so accented letters are silently missing from the
> printed receipt even though they show correctly on screen.

> Why LAN and not USB: the printer's IP survives reboots, needs no WinUSB/Zadig driver
> juggling, and one printer can serve two tills. The USB path needs the printer bound to the
> WinUSB driver with Zadig before Chrome will talk to it — that is the single most common
> install failure in Kenyan POS shops.

### 2.2 Cash drawer (RJ11, printer-driven)

| Model | KSh (approx.) | Spec |
|---|---|---|
| **X-POS BC-410** | **8,300 – 9,600** ex‑VAT | Cold-rolled steel, 5 note + 8 coin, 3-position key lock, removable tray, RJ11 **24 V** solenoid, 7.6 kg, 47.5 × 47 × 16.1 cm, ball-bearing slides (1 M cycles). |
| **Syble ECH-410** | **6,499 – 8,400** ex‑VAT | Steel, 5 bill + 8 coin, 3-position lock, RJ11/RJ12, **12 V / 24 V** solenoid, 5.8 kg, 410 × 420 × 100 mm, RJ11 cable in the box. |

**Voltage pairing matters.** The XP-Q851L's DK port outputs **DC 24 V / 1 A**. Pair it with
the **BC-410 (24 V)** or the **ECH-410 (12/24 V)**. Do not buy a 12 V-only drawer for this
printer — the drawer will pop weakly or not at all, and that is the classic
"drawer pops but stays open" fault.

### 2.3 Barcode scanner (2D, USB HID keyboard)

The software listens for keystrokes arriving < 40 ms apart and fires on Enter after 4+
characters (`src/hooks/useBarcodeScanner.ts`). So the scanner must be a **keyboard wedge that
sends Enter** — no driver, no pairing.

| Model | Type | KSh (approx.) |
|---|---|---|
| **Newland HR33 Marlin** | 2D, USB‑KBW/CDC/HID‑POS, 1.5 m drop, smart-stand compatible | **8,000 – 15,000** |
| **Newland HR32 Marlin** | 2D, USB | 8,000 – 15,000 |
| **Zebra DS2208** (`DS2208-SR7U2100SGW`) | 2D, USB/Bluetooth | 10,000 – 25,500 |
| **X-POS XP-2800** | 2D, USB Type‑B, plug-and-play, 2 m drop | 12,999 – 13,500 |
| **E-POS ES2D-2D** | 2D, USB + RS232, with stand | 8,000 |
| Honeywell Voyager 1470g | 2D, USB | 14,000 – 24,000 |
| X-POS XP-2200 | **1D only** | 7,499 — last resort, no QR |

**Non-negotiable on the purchase order:** 2D imaging (reads QR + damaged labels + phone
screens), **USB HID keyboard mode**, **"Add Enter/CR suffix" enabled**, plug-and-play with no
driver. Ask the supplier to *demonstrate* the Enter suffix before you pay.

### 2.4 Label printer (strongly recommended — buy it)

Most spare parts arrive with no barcode at all. Without printed SKU labels the scanner is
useless and the whole "tap-to-add" flow dies.

| Model | KSh (approx.) | Spec |
|---|---|---|
| **Xprinter XB-330B** | **9,999 – 11,599** | Direct thermal, USB, ESC/POS, 40×30 mm / 58×40 mm labels. |
| Xprinter XP-470B | 16,000 – 18,560 | 4-inch (108 mm) roll, USB. Use for big boxes and tyres. |

Buy **one** to start. Print a SKU barcode for every part as it is racked.

### 2.5 Optional

| Device | Model | KSh (approx.) |
|---|---|---|
| Customer display | 20×2 character VFD pole display (e.g. VFD 8000 POS pole) | 13,500 |
| Card terminal | Standalone bank PDQ — you type the approval code into the POS. No integration needed. | from your bank |
| Label rolls | 80 × 80 mm thermal receipt rolls | 350 – 700 / roll |
| Barcode labels | 40 × 30 mm or 58 × 40 mm direct-thermal, self-adhesive | 800 – 1,500 / roll |

---

## 3. Power and network

| Device | Model | KSh (approx.) |
|---|---|---|
| **UPS** | **APC Easy UPS BV1000I‑MSX** (1000 VA / 600 W, line-interactive, AVR, 4 universal outlets) | **12,999 – 16,000** |
| UPS (brand) | APC SRV1KRILRK 1000 VA / 600 W, 8 outlets | 13,500 ex‑VAT |
| UPS (value) | APC BV1000I‑MSX or any 650–1000 VA AVR unit | 7,000 – 15,000 |
| **Network switch** | **TP-Link TL-SG108** — 8-port gigabit, unmanaged, steel case | **1,200 – 4,000** |
| Network switch (alt.) | TP-Link TL-SG1008D — 8-port gigabit desktop | 6,500 incl. VAT |
| Router | Any ISP router with **≥ 3 LAN ports** and Wi-Fi (TP-Link Archer C6 / TL-WR940N class) | 4,000 – 7,000 |

**UPS sizing.** Draw: till terminal 30–50 W + receipt printer 48 W (24 V × 2 A) + router
10 W ≈ **110 W**. A 600 W UPS carries that for roughly **1.5–3 hours** on a healthy
battery — enough to finish the day's sales and print the Z-report. Plug the printer's mains
adapter into the UPS (the printer runs from its own brick, so it rides the UPS too).
Never put a laser printer on the UPS; a thermal printer is fine.

**Switch sizing.** The printer needs an Ethernet port of its own so you can give it a fixed
IP (e.g. `192.168.1.50`). The router's 3 LAN ports usually cannot cover PC + printer +
printer + future till, so add the 8-port TL-SG108 (cheap insurance) and reserve the printer
IP in the router's DHCP table.

---

## 4. How it all wires together

```
        ┌───────────────────── Shop LAN (192.168.1.0/24) ─────────────────────┐
        │                                                                       │
  [ISP]─┼─► [Router]─┬──► [Switch: TP-Link TL-SG108]                          │
        │            │        │                                                │
        │            │        ├──► [Receipt printer XP-Q851L]  192.168.1.50    │
        │            │        │      LAN ──► port 9100 (ESC/POS)                │
        │            │        │      RJ11 DK ──► [Cash drawer BC-410]           │
        │            │        │                                                │
        │            │        └──► [Till terminal]  192.168.1.10               │
        │            │              Chrome/Edge → http://localhost:8787         │
        │            │              Node 22 server → /api/print relay           │
        │            │              USB-A ──► [Barcode scanner HID]            │
        │            │              USB-A ──► [Label printer XB-330B]           │
        │            │                                                        │
        └────────────┴──► Internet (M-Pesa STK push via the gateway)           │
                                                                               │
   [UPS: APC BV1000I-MSX] ──► router + switch + till + printer mains adapter   │
```

Critical points:

1. **The till's local Node server is the print relay.** `server/index.ts` only forwards to
   private IPv4 addresses, so the server must be on the same LAN as the printer. If you run
   the server on a remote VPS instead, the till cannot print — you need a small local
   relay box on the shop LAN.
2. **Open the app at `http://localhost:8787`**, never at the LAN IP (see §1.3).
3. **Reserve the printer IP** in the router, or it will change and stop printing.
4. **The cash drawer plugs into the printer's DK port**, not into the till. The till sends
   the drawer-kick ESC/POS sequence over the same connection as the receipt.
5. **Scanner and label printer are on USB-A**, not on a USB hub — an unpowered hub kills
   the scanner's HID handshake.

---

## 5. Purchase order — send this to the supplier verbatim

```
OPTIMAS POS — HARDWARE SUPPLY REQUEST (one till counter)

A. TILL TERMINAL (15.6" touchscreen all-in-one, Windows 11 Pro)
   1. Touchscreen POS terminal, 15.6", 1920x1080 (FHD) 10-point capacitive touch
      - CPU: Intel N100 (or i5), 4 cores
      - RAM: 8 GB (16 GB preferred)
      - SSD: 256 GB
      - Ports: at least 4 x USB-A, 1 x RJ45 gigabit, 1 x audio out, VGA + HDMI
      - Windows 11 Pro pre-installed and activated
      - Preferred models: MSI PRO AP162T ADL / Partner-tech SP-635-E1 /
        generic N100 15.6" FHD AIO
   2. (If Option B) Mini PC Intel N100, 8 GB RAM, 256 GB SSD, RJ45 + 4 x USB
      + 15.6" FHD 1920x1080 TOUCHSCREEN monitor with VESA mount

B. RECEIPT PRINTER
   3. Thermal receipt printer, 80 mm (3"), direct thermal, ESC/POS
      - MUST have BOTH USB and ETHERNET/LAN
      - auto cutter, RJ11 "DK" cash-drawer port, 230 V adapter included
      - Preferred: Xprinter XP-Q851L (KSh 6,500-8,700)
        Alternative: Xprinter XP-Q80B / Epson TM-T20III
      - NOT the USB-only XP-Q801K

C. CASH DRAWER
   4. Heavy-duty steel cash drawer, 5 note + 8 coin, 3-position key lock,
      RJ11 printer-kick cable included, 24 V solenoid
      - Preferred: X-POS BC-410 (KSh 8,300) or Syble ECH-410 (KSh 6,499-8,400)

D. BARCODE SCANNER
   5. 2D barcode scanner, USB HID keyboard mode, plug-and-play, sends Enter
      after each scan (must be demonstrated before payment)
      - Preferred: Newland HR33 Marlin (KSh 8,000-15,000) / Zebra DS2208
        Budget: E-POS ES2D-2D (KSh 8,000)

E. LABEL PRINTER
   6. Direct-thermal label printer, USB, ESC/POS, for 40x30 mm / 58x40 mm labels
      - Preferred: Xprinter XB-330B (KSh 9,999-11,599)

F. POWER AND NETWORK
   7. UPS 1000 VA / 600 W line-interactive with AVR, 4+ outlets
      - Preferred: APC Easy UPS BV1000I-MSX (KSh 12,999-16,000)
   8. 8-port gigabit unmanaged network switch
      - Preferred: TP-Link TL-SG108 (KSh 1,200-4,000)

G. CONSUMABLES
   9. 80 x 80 mm thermal receipt rolls (x 10)
  10. 40 x 30 mm self-adhesive barcode label rolls (x 5)

Please quote:
  - each item separately, with the exact MODEL NUMBER and port list
  - 1-year vendor warranty (not "shop warranty")
  - stock availability and lead time
  - the price of spare thermal rolls and a spare receipt printer

TOTAL ESTIMATE REQUESTED: KSh ____________  (excluding the till terminal)
```

### Indicative totals (one till, ex‑VAT)

| Build | KSh |
|---|---|
| **Minimum viable** — existing laptop, XP-Q851L + generic RJ11 drawer + XP-2200 1D scanner | 16,000 – 22,000 |
| **Recommended** — N100 15.6" FHD AIO + XP-Q851L + BC-410 + HR33 Marlin + XB-330B + BV1000I‑MSX + TL-SG108 | **105,000 – 150,000** |
| **Premium** — MSI PRO AP162T (8/256) + Epson TM-T20III + BC-410 + Zebra DS2208 + XB-330B + APC UPS + TL-SG108 | 160,000 – 200,000 |

---

## 6. What NOT to buy

| Don't buy | Why |
|---|---|
| **Android all-in-one POS (Sunmi, Landi, Newland N91…)** | Their built-in printers use vendor SDKs that a web app cannot reach. Chrome on Android gives no WebUSB/Web Serial, so you lose the drawer kick and raw ESC/POS. Keep the till on Windows. |
| **58 mm receipt printer** | The POS supports 58 mm (`Settings → Hardware → Paper width`) but 80 mm fits long OEM part names and the KSh totals. Only buy 58 mm if the counter is physically narrow. |
| **USB-only receipt printer** (XP-Q801K) | No Ethernet → you are back to the Zadig/WinUSB driver dance, which fails again after every Windows update. |
| **12 V-only cash drawer** for the XP-Q851L | The printer's DK port is 24 V. Mismatched voltage = weak or dead drawer kick. |
| **1D laser barcode scanner** | Cannot read QR codes, damaged or curved labels. The price jump to 2D is small and it future-proofs the catalogue. |
| **A 4 GB / 128 GB / 1024×768 POS terminal** | This is the default config on the cheap terminals. 4 GB RAM runs the catalogue out of memory; 1024×768 drops the UI into the compact tablet layout. Specify 8 GB / 256 GB / 1920×1080 in the purchase order or you will get the 4 GB version. |
| **A server-grade machine or a tower PC under the counter** | Not needed. N100 is plenty. Spend the difference on the UPS and the scanner. |

---

## 7. Bring-up checklist (do this with the supplier, in this order)

1. **Plug the till into the switch, the switch into the router.** Confirm the till gets an IP.
2. **Install Node 22 LTS, Chrome, then the app.** `npm install && npm run build`.
3. **Start the server** and open `http://localhost:8787` — the login screen appears.
   Default PINs: owner `1234`, cashier `0000`. Change them in *Settings → Users*.
4. **Install it as an app** (Chrome menu → *Install Optimas POS*).
5. **Printer:** plug the printer into the switch. Hold **FEED while powering on** → the
   self-test page prints the IP address. In the POS: *Settings → Hardware → Receipt printer →
   Network (LAN)*, enter the IP and port **9100**, set paper width **80**, tick
   *Print receipt automatically after every sale*. Press **Print test page**.
6. **Reserve the printer IP** in the router's DHCP settings.
7. **Drawer:** RJ11 from the printer's **DK** port to the drawer. *Settings → Hardware →
   Test cash drawer*. Tick *Open cash drawer on cash sales*.
8. **Scanner:** plug into USB-A. Scan a barcode — the code should appear in the search box
   with no driver install. Scan a catalogue barcode → the part is added to the sale.
9. **Label printer:** install the vendor driver, load a 40×30 mm roll, print one test label
   and stick it on a part.
10. **M-Pesa:** *Settings → Payments*. Set the mode to STK push once the server `.env` has
    the gateway credentials (`docs/MPESA.md`), then send a KSh 1 test prompt to your own phone.
11. **UPS:** power-cut test — pull the mains plug and confirm the till, the printer and the
    router stay alive and you can still complete a sale.
12. **Backup:** *Settings → Backup → Export JSON* every day at close of business, and copy
    the file to a USB stick. Also back up `data/optimas.db`.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Test page prints nothing | The local server is not running | Start it: `npm run server:start` |
| "Printer IP address not set" | Mode is Network but the field is empty | Enter the IP from the printer's self-test page |
| Drawer does not pop on test | RJ11 not in the printer's **DK** port, or the wrong end | Swap the cable ends; check the printer manual for the DK socket |
| Drawer pops but stays open | Solenoid pulse length / 12 V vs 24 V mismatch | Use the BC-410 (24 V) with the XP-Q851L's 24 V DK output |
| Scan types the code but adds nothing | Scanner not sending Enter | Scan the "Add Enter suffix" code from the scanner manual |
| Scan does nothing at all | Scanner not in HID mode (e.g. COM/serial) | Scan the "USB HID" mode code from the scanner manual |
| "WebUSB is not available in this browser" | Wrong browser, or the app is open over a LAN IP | Use Chrome/Edge and open `http://localhost:8787` (secure context) |
| Printer not found by Chrome over USB | Printer bound to the vendor driver | Bind it to WinUSB with **Zadig**, or use LAN mode |
| Receipt prints but the drawer stays shut | The sale was not paid in cash | "Open drawer on cash sales" only fires for cash tenders |
| M-Pesa prompts not sending | Gateway credentials missing | See `docs/MPESA.md` — `.env` next to `package.json` |
| `npm install` fails on better-sqlite3 | Node version too old, or no prebuilt binary | Use Node 22 LTS; if still failing install VS Build Tools 2022 (Desktop C++) |
| Server will not start after `npm ci --omit=dev` | `tsx` is a devDependency | Run a full `npm install` |
| Everything works on USB but the till reboots daily | Browser lost the USB grant | Use LAN mode instead — it survives reboots and tab crashes |
| Page looks cramped / two-column | Panel is 1024×768, below the 1180 px desktop breakpoint | Use a 1920×1080 panel or set Windows display scaling to 100% |

---

## 9. Suppliers

Luthuli Avenue / Moi Avenue (Nairobi CBD) POS hardware dealers, Jumia Kenya, and local
Epson, Xprinter, Newland and Zebra resellers. Ask for:

- a **written quote** with the exact model number and port list
- a **1-year warranty** (vendor, not just the shop)
- a **demo of LAN printing** before you pay — plug it in and print from any machine on the
  same network
- **spare thermal rolls** and a spare printer in the same box if the budget allows
- a **clone of the configured till machine** (disk image) so a hardware failure is a 30-minute
  recovery, not a lost week of trading
