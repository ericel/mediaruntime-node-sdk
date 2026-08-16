# Contract maintenance

This contributor-only workflow requires access to the canonical gateway contract
checkout. The public SDK repository stores only the filtered public OpenAPI artifact and
cross-client conformance fixture.

After a public gateway contract change, synchronize the exact artifacts and run:

```bash
npm run contracts:sync -- --source /path/to/gateway/contracts
npm run contracts:check -- --source /path/to/gateway/contracts
npm test
```

`contracts/provenance.json` records a neutral source identifier and the SHA-256 digest of
each copied artifact. Normal CI validates the checked-in digests without another
repository; the optional `--source` check proves byte-for-byte parity during a coordinated
update.
