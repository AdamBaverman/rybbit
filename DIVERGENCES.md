# Rybbit fork differences

Upstream base `4288204761ed2fc801fcaa0b3bbfacd1b8cc3936`. [Vibrations Club issue #36](https://github.com/Phareek/vibrations-club/issues/36)

## Cross-site funnels and goals

- Funnels store optional `siteIds` in `funnels.data`. A step can optionally match one of those sites through `step.siteId`. Goals store optional `crossSite` settings in `goals.config`. The goal entry is a page pattern with an optional UTM source. Entry and conversion can each be limited to a selected site. Both existing JSON columns support these settings without a schema migration.
- A saved cross-site definition belongs to the site where it was created. Its site selection includes that site and at least one other site from the same organization. Each read or write of the definition requires current access to every selected site. Anonymous public dashboards and private-link visitors see the single-site definitions they already have access to.
- Cross-site sequences count distinct stored device fingerprints (`user_id`). Events in the same second can satisfy adjacent steps. The goal denominator is users who reached its entry, and trend buckets are based on the entry time. Dashboard filters qualify the session containing the entry event. Later steps can come from any selected site under their own conditions.
- Single-site reports continue to use their existing session calculations. Cross-site counts use the existing API statistic fields for compatibility and are labelled as users in the detailed interface. The existing session and replay drill-downs apply to single-site calculations. Site-wide session totals continue to measure the current site's sessions.
- Cross-site matching depends on comparable recorded fingerprints. The `saltUserIds=false` fingerprint path uses IP and normalized User-Agent without the site ID. The `anonymous_id` path includes the site ID in the hash. At an upstream update, check that sites in the set still use comparable identifiers and rerun the nonzero fixture. Collection and replay code use the upstream behavior.

## Updating the upstream pin

Carry the issue #36 commits onto the new upstream pin and build the client and backend from that same revision. Verify cross-site visibility, the six nonzero step counts, and existing single-site fixtures before replacing the image pins together. Saved settings live in the two JSON columns and can be read again when the fork images are restored. Recheck the scope and identity paths above when rebasing.
