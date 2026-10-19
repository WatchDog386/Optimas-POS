# M-Pesa setup

The POS supports two M-Pesa modes (*Settings → Payments*).

## 1. Manual (default, no setup)

The customer pays to the shop's **Till / Paybill**. The cashier checks the confirmation SMS on the shop phone and types the 10-character code (for example `SJK7AB12CD`) into the payment screen. The code is stored on the sale and printed on the receipt, and you can search for it in *Sales history*.

This works offline and costs nothing extra. Most shops start here.

## 2. STK Push (Lipa Na M-Pesa Online)

The cashier enters the customer's phone number. A PIN prompt pops up on that phone, and the sale completes automatically when the customer pays.

### What you need

1. A **Daraja** account at https://developer.safaricom.co.ke. Create an app to get a **Consumer Key** and **Consumer Secret**.
2. **Go Live** in the Daraja portal with your Till or Paybill. Safaricom then emails the **production Passkey**.
   - **Paybill:** `MPESA_SHORTCODE` = the paybill number, and leave `MPESA_TILL` empty.
   - **Buy Goods Till:** `MPESA_SHORTCODE` = the *store / head-office number* Safaricom links to the till, and `MPESA_TILL` = the till number.
3. A **public HTTPS callback URL** that reaches the POS server's `/api/mpesa/callback`. Options:
   - Run the server on a small VPS, or
   - expose the shop PC with a tunnel (Cloudflare Tunnel / ngrok).

   If the callback can't reach the server, the POS asks Daraja for the status directly (STK Query) after about 10 seconds. The sale still completes, but without the M-Pesa receipt number.

### Configure

```bash
cp .env.example .env   # then fill in the values
npm run server:start
curl localhost:8787/api/health   # → {"ok":true,"mpesa":"sandbox"}
```

Test with `MPESA_ENV=sandbox`, shortcode `174379` and the sandbox passkey from the Daraja portal, then switch to `production`.

### Security

- Credentials stay on the server in `.env` and never reach the browser. `.env` is git-ignored.
- The server only relays printer traffic to private (LAN) IP addresses.
