# Changelog

## [0.2.0](https://github.com/crs48/feedme/compare/v0.1.0...v0.2.0) (2026-10-09)


### Features

* add isolated Stripe sandbox deployments ([7a32ae8](https://github.com/crs48/feedme/commit/7a32ae853a7dc338341b164b86f1ff64757efe80))
* automate reviewed releases and versioned container delivery ([6e4990d](https://github.com/crs48/feedme/commit/6e4990da4d3f5af9df34ed48546e3112ceba1b9f))
* **branding:** personalize self-hosted sites and add Feedme attribution ([22bce64](https://github.com/crs48/feedme/commit/22bce6445b6429c2aeead753731937661f77e022))
* **design:** apply clean layouts across Feedme ([#14](https://github.com/crs48/feedme/issues/14)) ([54d11c9](https://github.com/crs48/feedme/commit/54d11c910cb8a06cfc1fb9e5394a1ef60d7fd8da))
* discover and publish verified Feedme creator profiles ([800e905](https://github.com/crs48/feedme/commit/800e905fe76e9e93f3c57f432cd75da253f0535f))
* isolate Stripe sandbox deployments ([#10](https://github.com/crs48/feedme/issues/10)) ([7718fa4](https://github.com/crs48/feedme/commit/7718fa48d9eec4316e8794a81b8e3ed94646254f))
* **libcard:** add catalog picks and consumer integration ([#2](https://github.com/crs48/feedme/issues/2)) ([1402b85](https://github.com/crs48/feedme/commit/1402b8553ac018876998ab4a400aac66a3708aec))
* **libcard:** add managed targets and pick-based support ([7eeb15e](https://github.com/crs48/feedme/commit/7eeb15e7402cfd153e90c620862050f58fb02a5c))
* **libcard:** enable support for all links by default ([bf56395](https://github.com/crs48/feedme/commit/bf563955c6fc84d4526a973b6ae00a48b77ce447))
* **libcard:** enable support for all links by default ([4014e51](https://github.com/crs48/feedme/commit/4014e510bfdaf5678cc9330b0a1e73cde858d9ab))
* **libcard:** preview real profiles with simulated payments ([dff0d15](https://github.com/crs48/feedme/commit/dff0d150a360829599db5239de261221658fa618))
* **libcard:** show complete link catalog with icons and goals ([4f08402](https://github.com/crs48/feedme/commit/4f084020dd3bd2d7b26d3f0be474f0b3d5e1e24c))
* **libcard:** support per-item skip flags ([#11](https://github.com/crs48/feedme/issues/11)) ([dc1c914](https://github.com/crs48/feedme/commit/dc1c914d9c2d1d128b332ee647861d3ba9e4b025))
* **payments:** guide creators through Stripe setup and readiness ([#8](https://github.com/crs48/feedme/issues/8)) ([47b9d20](https://github.com/crs48/feedme/commit/47b9d201e29725b316ccc12a602ae97e0553cd2c))
* **payments:** support personal Stripe accounts and environment isolation ([#9](https://github.com/crs48/feedme/issues/9)) ([8565cfd](https://github.com/crs48/feedme/commit/8565cfdd07066dae8d3906138e436c9567999c70))
* **setup:** add a copyable agent-guided installation prompt ([#25](https://github.com/crs48/feedme/issues/25)) ([5e995ff](https://github.com/crs48/feedme/commit/5e995ff0a92aac08fe385d25d7d330accb3c002d))
* show shared Bluesky messages in support timelines ([#12](https://github.com/crs48/feedme/issues/12)) ([9ee57a1](https://github.com/crs48/feedme/commit/9ee57a191c0c7e8ef44c07c0d7b319531f0f6dc3))
* **site:** add LibCard integration pages ([ecd2ea6](https://github.com/crs48/feedme/commit/ecd2ea6fc90c8071402d7de6322ebf1642c6626c))
* **site:** explain the LibCard integration and setup ([3b0a946](https://github.com/crs48/feedme/commit/3b0a9469e1daad197196990aef6214bcdd2cee74))
* **site:** showcase the live crs.land and Tip Chris integration ([1b70b3f](https://github.com/crs48/feedme/commit/1b70b3f8abf7f4b5f830e8f2bc389c2f97f4b524))
* **studio:** compact dashboard lists with contribution popovers ([#21](https://github.com/crs48/feedme/issues/21)) ([518c4bb](https://github.com/crs48/feedme/commit/518c4bbd847eccbfb04eabc8060b68dda5e2f8c7))
* use supplied Feedme artwork throughout app branding ([2ac3df2](https://github.com/crs48/feedme/commit/2ac3df20507e4d7c875d33d3b581db849bce6a94))
* version database schemas and expose installed releases ([26e2aef](https://github.com/crs48/feedme/commit/26e2aef71f4dbcdca018b81c391fcf569e800066))


### Bug Fixes

* **auth:** restore Habitat sign-in with explicit signing-key metadata ([#7](https://github.com/crs48/feedme/issues/7)) ([42c307b](https://github.com/crs48/feedme/commit/42c307b8dcecdf3bc9ae728f8765bb9e7c921c4f))
* **billing:** handle scheduled cancellations and zero-value adjustments ([05a0929](https://github.com/crs48/feedme/commit/05a092937d25d6251117db5d275ebd0d95ca5246))
* **bluesky:** preserve DID colons in profile and post links ([#15](https://github.com/crs48/feedme/issues/15)) ([a888c12](https://github.com/crs48/feedme/commit/a888c127bb897185330be88247b7c879bd089981))
* bound retained directory state and export processing ([218ae21](https://github.com/crs48/feedme/commit/218ae21bf72f9c148f7cb75bd43c0d248f112bbf))
* **demo:** match the live LibCard pick experience ([#23](https://github.com/crs48/feedme/issues/23)) ([1ec9e78](https://github.com/crs48/feedme/commit/1ec9e7848f24b44f5e26cd93b4f12a1fdfaff40d))
* **directory:** import and display Bluesky creator avatars ([#22](https://github.com/crs48/feedme/issues/22)) ([5bbb777](https://github.com/crs48/feedme/commit/5bbb777cfe4c67af0746afdd325016a1bdb8b1b9))
* group recent tips by payment and resolve supporter profiles ([0c8331f](https://github.com/crs48/feedme/commit/0c8331f441169c21aa2250b157c0c2e7e5367dda))
* keep long tip breakdowns inside the viewport ([ff9ef51](https://github.com/crs48/feedme/commit/ff9ef51e02079fb139c2cefa28a4f1fd3e863715))
* **libcard:** use Bluesky identity in creator headers ([#13](https://github.com/crs48/feedme/issues/13)) ([f0e63a7](https://github.com/crs48/feedme/commit/f0e63a7d1072f1c2df525e135411128bd5cd343c))
* **libcard:** verify consumer contract and expose import errors ([baa9c99](https://github.com/crs48/feedme/commit/baa9c9986b1dc29c4119f0e2afbbea917a9785d4))
* **timeline:** limit popover hover to the support label ([#24](https://github.com/crs48/feedme/issues/24)) ([f9ed436](https://github.com/crs48/feedme/commit/f9ed436df5b342467d7ac3ac216f63e3e4bb55a3))
* **ui:** align LibCard picks with the original design mockup ([#17](https://github.com/crs48/feedme/issues/17)) ([2af6522](https://github.com/crs48/feedme/commit/2af65222cda62ecc3d29c2b72fc0213f8309e9ed))
* **ui:** open project links in new tabs to preserve selections ([#18](https://github.com/crs48/feedme/issues/18)) ([3df761b](https://github.com/crs48/feedme/commit/3df761bd291c645262c8f06069d505056eaa59d2))
* **ui:** remove the imported LibCard intro from tip pages ([6490a52](https://github.com/crs48/feedme/commit/6490a52cf19df222c9a795f6b23e01599cf2d910))
* **ui:** remove the imported LibCard intro from tip pages ([a2d6fbf](https://github.com/crs48/feedme/commit/a2d6fbf8ad68ff76020eacf5c3620ed58060b6f8))
* **ui:** stabilize pick rows and compact social chips ([#16](https://github.com/crs48/feedme/issues/16)) ([c8c6707](https://github.com/crs48/feedme/commit/c8c67070824c6bde98d05a1ea55f19d0bfca5874))
