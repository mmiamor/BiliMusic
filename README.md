# BiliMusic

BiliMusic 支持哔哩哔哩、酷我、网易云音乐和 Radio Paradise 无损电台，提供 Windows 桌面应用、iOS 自建工程和 PWA。

仓库：<https://github.com/mmiamor/BiliMusic>

## 0.3.2

- B 站首页默认“Hi-Res 优先”：候选内容立即显示，每页后台核验前六首新投稿，当前账号返回且设备支持解码的 Hi-Res 优先排序。标题中的 Hi-Res/无损字样只作为搜索线索，不作为认证。
- 音质证据区分 Hi-Res 档位、普通无损、当前有损、设备不支持与尚未确认；不会凭 FLAC 推定 24 bit / 96 kHz。账号切换会失效证据，实际播放重新解析。
- 新增“Hi-Fi 音源”页，接入 Radio Paradise 四个官方 Ogg FLAC 直播频道，明确标注 16 bit / 44.1 kHz CD 无损并禁用进度拖动。Windows 和 PWA 可在应用内收听；iOS 原生版暂转官方页面。
- Qobuz、TIDAL、QQ 音乐提供明确标识的外部官方入口，尚未接入本应用播放器。平台可用性与接入条件见 [Hi-Fi 音源核验](docs/hifi-sources.md)。

## 0.3.1

- 发现页展示真实的哔哩哔哩音乐投稿，提供热门、最新、现场、翻唱、演奏、原创六类，支持刷新和分页。热门限定近 30 天并按播放量排序。
- 重新调整侧栏、字号、留白、横向封面卡、播放详情和底部控制；首页去掉重复标题，最近播放可直接继续收听。
- 分类保留独立缓存，刷新失败保留已有内容。推荐和最近播放使用各自的队列，异步响应不会覆盖正在浏览的分类。

此前版本已完成：

- macOS 风格的浅色界面、原创音符图标与红黄绿窗口控制，移除二次元装饰、渐变氛围背景和界面动画。
- 播放详情采用双栏布局：左侧保留歌曲、封面、进度和主控制；右侧切换歌词、队列和十段 DSP。小窗口改为纵向布局。
- 修复 Windows 读取哔哩哔哩合集时的 `net::ERR_BLOCKED_BY_CLIENT`，保留平台会话和域名白名单。

本仓库是当前开发源码，0.3.2 尚未更新到公开站点。界面取舍见 [发现页设计](docs/discovery-design.md) 与 [播放页设计](docs/player-design.md)，可下载 [发现页交互原型](docs/discovery-prototype.html) 后本地打开。

![Hi-Res 优先发现，音质按实际核验结果显示](docs/hifi-discovery.webp)

[查看 Hi-Fi 音源页](docs/hifi-sources.webp)

## Windows

需要 Node.js 24。在仓库根目录执行：

```powershell
npm ci
npm test
npm start
```

生成 Windows x64 便携包：

```powershell
npm run dist:win
```

输出位于 `dist/`。完整解压 ZIP 后运行 `BiliMusic.exe`。应用未签名；收藏与平台登录会话保存在当前设备的应用配置目录。

## iOS

仓库包含完整 Xcode 工程和 IPA 构建脚本。需要 macOS 与 Xcode 16 或更新版本，最低支持 iOS 16。

```sh
bash scripts/build-ipa.sh unsigned
# 本机已有开发团队与签名配置时：
TEAM_ID=YOUR_TEAM_ID BUNDLE_ID=com.yourname.bilimusic bash scripts/build-ipa.sh signed
```

也可打开 `ios/BiliMusic.xcodeproj`，设置自己的 Team 与 Bundle Identifier 后连接设备运行。未签名 IPA 需使用自己的 Apple 身份和适用的设备描述文件签名；本轮未进行 Xcode 编译或真机验收。

GitHub 的 **Actions → BiliMusic build → Run workflow** 可选择 `ios`、`windows` 或 `both`。文件保存到该次运行的 Artifacts，不会发布网站或创建公开 Release。

## 使用

- 首页推荐来自音乐分区搜索，按页面注明的范围和排序展示。投稿能否播放与实际音质取决于平台返回的音轨和当前账号权限。
- 首页底部的“离线试听”保留《山间来信》三首原创合成器试听曲，格式为 16 bit / 44.1 kHz FLAC。
- 哔哩哔哩支持关键词、BV、AU、分 P 链接、UP 主投稿及公开合集；官方登录后重新解析账号有权播放的音轨。
- 酷我支持歌曲、歌手、专辑与同步歌词。音质以平台实际返回的格式为准。
- 网易云支持歌曲、歌手、专辑、歌词、热门与最新评论。播放限制不影响公开评论的查看。
- 歌曲、作者、合集、歌手和专辑可分别收藏。歌词支持原文、可用注音/译文和点击定位。
- DSP 提供十段均衡、预设、前级与限幅，设置实时作用于音频。

## PWA

`src/` 与原生应用共用界面，`pwa/` 提供同源会话和流媒体服务。独立验证：

```sh
cd pwa
npm ci
npm test
```

部署时需自行配置 HTTPS 域名、反向代理及服务管理。仓库不包含原运行环境的 DNS 凭据、主机配置或自动部署任务。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `src/` | 播放界面、音源、歌词、资料库、DSP、PWA 缓存 |
| `windows/` | Electron 窗口、隔离桥、网络与官方登录 |
| `ios/` | Swift / WKWebView 工程与音频桥 |
| `pwa/` | 网页会话及流媒体服务 |
| `tests/` | 播放器、音源、歌词、资料库、评论和 Windows 请求回归 |
| `scripts/` | IPA 构建、图标导出及原创试听曲生成 |
| `docs/` | 播放页原型、设计说明与验证截图 |
| `.github/workflows/` | 自动测试及手动应用构建 |

图标矢量源为 `src/icons/app.svg`。安装 `PyMuPDF` 和 `Pillow` 后，执行 `python scripts/export-native-icons.py` 可重新导出 PNG、ICO 与 iOS AppIcon。

参考、素材来源和第三方库许可见 [设计与音源说明](docs/design.md) 与 [pinyin-pro 许可说明](src/vendor/pinyin-pro/PROVENANCE.md)。
