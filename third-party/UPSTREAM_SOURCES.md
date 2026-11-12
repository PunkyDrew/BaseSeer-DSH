# BaseSeer dependency sources and notices

BaseSeer bundles elkjs 0.12.0. The retained inventory `upstream-sources.json` identifies source versions, URLs, hashes and notice origins. `UPSTREAM_NOTICES.txt` retains upstream notices; packaged `THIRD_PARTY_NOTICES.txt` covers bundled npm dependencies.

The elkjs distribution corresponds to [commit ff5771d7](https://github.com/kieler/elkjs/tree/ff5771d7165445c42c408bb8a090c8035272218c); its release identifies [ELK 0.12.0](https://github.com/eclipse-elk/elk/tree/323312916048544e4e594eab3303cdb0d01e2929).

## Source delivery

Provide the matching source companion alongside each private package, through the same delivery channel without an additional charge. The companion, `dsh-baseseer-upstream-0.12.0-r4.tar.gz` (`r4` is its revision), holds every file the inventory lists, together with the inventory, this document and `UPSTREAM_NOTICES.txt`; its SHA-256 record is `dsh-baseseer-upstream-0.12.0-r4.tar.gz.json`. Retain that record, original sources, source JARs, build instructions, metadata, licenses and copyright headers.

| Component | Retained terms |
|---|---|
| elkjs / Eclipse ELK 0.12.0 | EPL-2.0 and original secondary-license notices |
| EMF GWT common/ecore 2.12.4 | EPL-1.0 |
| Xtext/Xtend 2.36.0 | EPL-2.0 |
| GWT 2.11.0 | Apache-2.0 and included component notices |
| Guava 31.1-jre / failureaccess 1.0.1 | Apache-2.0 |
| Babel helpers 7.26.7, browser-pack 6.1.0, UMD 3.0.3, web-worker 1.4.1 | Retained MIT / Apache-2.0 notices |

The companion includes broader compiler and sample material; inclusion there does not imply runtime inclusion. Build instructions describe the upstream Java/GWT/Gradle/Xtext toolchain. Matching release JavaScript does not establish a byte-for-byte reproducible compiler build, and an inspected attestation is not an independently verified signature.

Bundling does not replace upstream licenses. BaseSeer's private package marker cannot restrict rights those licenses grant. Project licensing and wider distribution remain owner decisions.
