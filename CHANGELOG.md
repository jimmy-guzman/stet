# Changelog

## [0.1.5](https://github.com/jimmy-guzman/sideye/compare/sideye-v0.1.4...sideye-v0.1.5) (2026-06-12)


### Features

* **diagnostics:** ✨ support monorepo workspace typecheck discovery ([#11](https://github.com/jimmy-guzman/sideye/issues/11)) ([dfd44ff](https://github.com/jimmy-guzman/sideye/commit/dfd44ff9ab0a11b50acafa0cdb103c1595ac2cda))
* **ui:** ✨ smart truncate tree names preserving extension ([#18](https://github.com/jimmy-guzman/sideye/issues/18)) ([deea032](https://github.com/jimmy-guzman/sideye/commit/deea032b46ef4cf772556b913c240e25cb119a5d))
* **ui:** ✨ surface activity on collapsed directories ([#15](https://github.com/jimmy-guzman/sideye/issues/15)) ([61e4984](https://github.com/jimmy-guzman/sideye/commit/61e4984336cd181125951ea9740167eadd918414))
* **ui:** ✨ toggle file tree sidebar with b key ([#19](https://github.com/jimmy-guzman/sideye/issues/19)) ([1c22761](https://github.com/jimmy-guzman/sideye/commit/1c22761170ea98722058f2ea799d945e9ffae9ff))


### Bug Fixes

* **install:** 🐛 add sideye bin to PATH automatically ([#14](https://github.com/jimmy-guzman/sideye/issues/14)) ([ef4df03](https://github.com/jimmy-guzman/sideye/commit/ef4df031d1e02c0d9f1161c2a471014644642a69))
* **ui:** 🐛 reserve badge space when tree rows ([#20](https://github.com/jimmy-guzman/sideye/issues/20)) ([049fdd4](https://github.com/jimmy-guzman/sideye/commit/049fdd4b4428513923ab347d0d98dc29dfccf186))


### Performance Improvements

* ⚡️ defer repo file enumeration to after initial render ([#13](https://github.com/jimmy-guzman/sideye/issues/13)) ([e123e23](https://github.com/jimmy-guzman/sideye/commit/e123e230a134f4a27af034ce314d1901e86a2b05))
* **lint:** ⚡️ enable perf oxlint rules ([#16](https://github.com/jimmy-guzman/sideye/issues/16)) ([c0d313c](https://github.com/jimmy-guzman/sideye/commit/c0d313c263b5ea7754def59759533cd2359dbafe))

## [0.1.4](https://github.com/jimmy-guzman/sideye/compare/sideye-v0.1.3...sideye-v0.1.4) (2026-06-11)


### Performance Improvements

* ⚡️ two-tier polling to reduce ls-files frequency on large repos ([#8](https://github.com/jimmy-guzman/sideye/issues/8)) ([4e4372f](https://github.com/jimmy-guzman/sideye/commit/4e4372f9c96199d34537f5c6d28bf91568cf5bef))

## [0.1.3](https://github.com/jimmy-guzman/sideye/compare/sideye-v0.1.2...sideye-v0.1.3) (2026-06-11)


### Bug Fixes

* 🐛 pass NPM_TOKEN to npm publish step ([#6](https://github.com/jimmy-guzman/sideye/issues/6)) ([81014cf](https://github.com/jimmy-guzman/sideye/commit/81014cf503058f9fc9da641a03c52aaa196745f0))

## [0.1.2](https://github.com/jimmy-guzman/sideye/compare/sideye-v0.1.1...sideye-v0.1.2) (2026-06-11)


### Bug Fixes

* 🐛 exclude CHANGELOG.md from oxfmt checks ([#4](https://github.com/jimmy-guzman/sideye/issues/4)) ([9806c2b](https://github.com/jimmy-guzman/sideye/commit/9806c2b2ebd33beec646298340413002bec1fd11))

## [0.1.1](https://github.com/jimmy-guzman/sideye/compare/sideye-v0.1.0...sideye-v0.1.1) (2026-06-11)


### Features

* ✨ initial version of `sideye` ([#2](https://github.com/jimmy-guzman/sideye/issues/2)) ([e70c3a7](https://github.com/jimmy-guzman/sideye/commit/e70c3a78b190fb5d5a0a40e8737a88a752a475b5))
