# breached-passwords.txt

Passwords from the UK NCSC "100k most used passwords" list that are at least
12 characters long (OGS rejects anything shorter anyway), de-duplicated and sorted.

- Source: SecLists, `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`
  (https://github.com/danielmiessler/SecLists), MIT License, © Daniel Miessler.
- Used by `BreachedPasswords` (Phase 3 plan §2.1, decision P3-4). The check is
  case-insensitive. An online HIBP k-anonymity check can be enabled later.
- To refresh: download the list again and keep only lines of 12–128 characters.
