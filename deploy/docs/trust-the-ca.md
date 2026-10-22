# Trusting the Verity certificate on PCs and phones

Mode B uses an internal certificate authority because your Verity address (for example `verity.dsew.lan`) is not on the public
internet, so no public authority can vouch for it. Each device must be told once to trust yours. The file is
`deploy/config/tls/root.crt` on the server; it contains no secret and can be sent by email or WhatsApp.

Install it only from the server's own copy. Never install a certificate someone else sends you.

## Windows PC

1. Double-click `root.crt`, choose **Install Certificate**, **Local Machine** (needs an administrator), then **Place all
   certificates in the following store** and pick **Trusted Root Certification Authorities**.
2. Restart the browser. Chrome and Edge use the Windows store. Firefox keeps its own list: Settings, Privacy and Security,
   Certificates, View Certificates, Authorities, Import, tick "Trust this CA to identify websites".

For many PCs, an administrator can push the file through Group Policy: Computer Configuration, Policies, Windows Settings, Security
Settings, Public Key Policies, Trusted Root Certification Authorities, Import.

## Android phone

1. Copy `root.crt` to the phone. Settings, Security (or Security and privacy), More security settings, Encryption and
   credentials, **Install a certificate**, **CA certificate**, accept the warning, choose the file.
2. Chrome on Android uses this store. Some phones need a screen lock set before they allow the install.

## iPhone and iPad

1. Open `root.crt` on the device (email or a file link). Settings shows "Profile Downloaded"; open it and tap **Install**.
2. Then Settings, General, About, **Certificate Trust Settings**, switch on full trust for "Verity internal root CA".

## Check it worked

Open `https://verity.dsew.lan` (your real name). There must be a padlock and **no** warning page. If there is a warning, the device
does not yet trust the certificate, or it cannot resolve the name; check the name first (it must resolve to the server's address).

## When the certificate is renewed

The server certificate lasts 825 days; the authority lasts 10 years. Renewing the server certificate does **not** need anything
done on devices, as long as the authority file (`root.key`, kept offline) is used to sign it again. If the authority itself is
lost, every device must be given the new `root.crt` again.
