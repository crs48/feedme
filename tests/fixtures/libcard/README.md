# LibCard consumer fixtures

`enabled.config.yaml` and `public-response.json` are unmodified copies from [crs48/LIBCard](https://github.com/crs48/LIBCard), commit `fed406d`, under `src/lib/fixtures/feedme/`. That commit is on `claude/libcard-feedme-integration-13bddf`. They are covered by the [LibCard MIT license](../../../licenses/LIBCard.txt).

The JSON is a consumer shape/forward-compatibility fixture, including unknown fields and an API-only target. It is not Feedme payment history or an expected monetary total. Feedme's endpoint keeps its stricter public-field allowlist.

The YAML imports `creator`, `presence`, `open-source`, `retired`, and `x`; the HTTP fixture hides `retired` locally. `seed.ts` runs only in a fresh temporary demo process, then deliberately triggers a native-ID collision to verify Studio's diagnostic and last-good retention. No test contacts GitHub, Stripe, or Habitat.
