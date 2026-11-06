# pinyin-pro

The offline Mandarin readings use [pinyin-pro 3.29.5](https://www.npmjs.com/package/pinyin-pro/v/3.29.5) by zh-lx under the adjacent MIT license. The browser module bundles the upstream pinyin function and its dictionaries. Both app shells load it from their own resources.

To reproduce the module in an empty directory, run:

```sh
npm pack --ignore-scripts pinyin-pro@3.29.5
tar -xzf pinyin-pro-3.29.5.tgz
npx --yes --package=esbuild@0.25.12 esbuild package/dist/esm/core/pinyin/index.mjs --bundle --format=esm --target=safari16 --charset=utf8 --outfile=index.mjs
```

Copy the generated `index.mjs` and `package/LICENSE` into this directory. The upstream npm tarball integrity is `sha512-Fk5YoRmtdHqJWqAuzYVG/NzvzeCbaG+ZEwbY6Nbps3QAIrvQQEtcm49frcyCM8i2b5najnzPDtYqrHRYTTiuwQ==`.
