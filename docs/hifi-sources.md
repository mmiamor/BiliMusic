# HiFi 音源接入核验

截至 **2026-11-06**。本文以官方公开页面为依据；Radio Paradise 四个频道另做了限量流头读取和独立 Electron 解码验证。没有申请开发者账号、使用用户凭据、启动网站服务或发布应用。

## 本次结论

优先接入 **Radio Paradise 的四个官方 FLAC 直播频道**。不需要听众登录或自行申请 API 密钥，官方明确提供网络播放器使用的直连地址。它们当前传输的是 **16 bit / 44.1 kHz 双声道无损音频**，应标为 CD 无损直播，不能标为 Hi-Res。来源：[官方播放器直连页](https://radioparadise.com/listen/stream-links)。

**Mother Earth Radio 已停播，2L 免费 testbench 当前不可用。** QQ 音乐、酷狗、Qobuz、TIDAL 的完整曲库不能视为匿名、免授权的公开 FLAC 地址库。应用可以提供清楚标注的官方入口；真正接入需要分别满足其开发者、账号、地区及播放权限条件。

本文用实际位深和采样率表达音质。FLAC 是无损编码，并不自动意味着高解析度；24 bit / 48 kHz、24 bit / 192 kHz 与 16 bit / 44.1 kHz 不能混标。直播传输参数也不证明每首录音的原始母带都有相同规格。

## Radio Paradise：本次可以实施

官方页面有频道和编码选择器，明确让听众将生成的 URL 复制到播放器。选择 FLAC 后，页面生成 HTTP 地址；下表使用同一官方主机和路径的 HTTPS 版本，四条均于本次实际验证返回 HTTP 200。

| 频道 | 本次验证的 HTTPS 直连 |
| --- | --- |
| Main Mix | [主频道 FLAC](https://stream.radioparadise.com/flac) |
| Mellow Mix | [轻柔频道 FLAC](https://stream.radioparadise.com/mellow-flac) |
| Rock Mix | [摇滚频道 FLAC](https://stream.radioparadise.com/rock-flac) |
| Global Mix | [环球频道 FLAC](https://stream.radioparadise.com/global-flac) |

官方页面另外列有 Beyond、Serenity、Radio 2050、KFAT 的 FLAC 选项，本次不将尚未做播放验证的频道加入默认列表。出处：[Radio Paradise Stream Links](https://radioparadise.com/listen/stream-links)。

### 实测证据与应用约束

- 四条上游响应均为 `Content-Type: application/ogg`，首包为 `OggS`；内部 FLAC `STREAMINFO` 均报告 `44100 Hz / 16 bit / 2 channels`。它是 **Ogg FLAC**，不要伪标成裸 `audio/flac`。
- 独立 Electron 44.5.1 实例使用临时用户目录，以固定地址的自定义协议代理将 Main Mix 交给 HTMLAudioElement 和 WebAudio。实际媒体时间推进至约 `0.543 s`，分析节点测得 RMS 约 `0.124`，证明成功解码；最终输出增益为零，没有做主观听音评价。
- 该次 `AudioContext.sampleRate` 为 `48000 Hz`。源文件无损与最终输出是否经过系统重采样是两件事，不能据此承诺 bit-perfect 或硬件独占输出。
- 上游未返回 `Access-Control-Allow-Origin`。PWA 的跨域 WebAudio/DSP 路径需要正确处理 CORS；桌面端可用受控媒体协议。不能仅以 `canPlayType()` 结果代替真实播放测试。
- 这是无限时长直播，实测 `duration` 非有限值。播放器应显示直播状态，禁用按整首长度计算的 seek，不缓存成“完整歌曲”下载。iOS 当前整曲下载播放路径不适合直接复用，需要单独的流式播放器实现或跳转官网。
- 固定白名单只允许这四条 HTTPS URL，不接受任意调用方 URL、重定向到无关主机、附加查询参数或用户自带鉴权。失败要保留明确提示，不静默切成 MP3 却继续显示 FLAC。

本地真实测试报告：`dist/qa-hifi/ogg-flac-report.json`。新 provider：`src/radio.mjs`；边界测试：`tests/radio.test.mjs`。本次解码验证通过 Main Mix，其余三条做了流头验证，尚未逐条长时间播放。官方公开播放器链接支持直接收听的用途，不应把它理解成下载、重新发行或收费转播的许可。

## 其他公开直播与试听候选

| 来源 | 官方证据与当前状态 | BiliMusic 适合程度 |
| --- | --- | --- |
| Mother Earth Radio | [官网](https://motherearthradio.de/) 明确已停止运营。其原运营者的新站也说明 Mother Earth 在 2026 年 7 月结束。 | 不集成旧直播地址，不显示为可用音源。 |
| Munich Vinyl Radio | [官网](https://munichvinylradio.de/) 宣称 FLAC 192 kHz，并提供 [官方 PLS 播放列表](https://stream.munichvinylradio.de/public/mvr/playlist.pls)。官网明确 GEMA/GVL 许可仅覆盖德国，不能把录音环节的 32 bit 直接当作直播位深。PLS 本次读取返回 502，未验证具体媒体地址及解码。 | 可提供地区明确的官方入口；不作为面向中国用户的默认直播源，不绕过地区限制。它是新电台，不应冒称仍在运营的 Mother Earth。 |
| 2L Test Bench | [官方 testbench](https://www.2l.no/hires/) 当前明确不可用，未来是否以缩减形式回归未定；页面指向 [2L 商店](https://shop.2l.no/)。 | 不预置网上流传的旧样本 URL。当前可做官方购买入口和用户合法取得的本地文件导入。 |
| Radio Calico | [当前首页](https://www.radio-calico.com/) 宣称 24 bit / 48 kHz 无损直播，并直接提供 [HTTPS FLAC](https://stream.radio-calico.com/calico)。[较旧官方介绍](https://www.radio-calico.com/radio-calico/) 仍写仅限美国，当前首页未重复该限制；官方 [关于非授权转播的说明](https://www.radio-calico.com/2024/05/16/if-youre-hearing-ads-its-not-radio-calico/) 反对降质、叠加广告的第三方转播。 | 有明确高解析度传输规格的候选，但本次未核实地区政策变更及实际流格式，不进入默认接入列表。需向官方确认地区适用范围并实际解码验证。 |

## 主流订阅平台的官方接入条件

### QQ 音乐

[官方 OpenAPI 接入说明](https://y.qq.com/music_developer/#/docs/openapi#/overview) 当前明确：先联系商务取得申请入口，应用审核后取得 `app_id` 和 `app_key`，暂不接受个人开发者申请。接口使用签名、时间戳和频率限制，并按账号会员权益和商务合作方式控制可返回内容；完成开发后需验收并按要求上报播放流水。

[官方歌曲接口说明](https://y.qq.com/music_developer/#/docs/openapi#/feature/song) 区分 `song_play_url_sq` 无损及 `song_play_url_xq` Hi-Res，部分音质还需要特定会员或商务开通。文档存在这些字段，不等于当前应用已获得这些地址或权限；该页也不足以断言所有歌曲都是某个固定采样率。

适合度：本阶段只提供官方入口。后续以获批合作方身份接入；由应用开发方管理获批凭据，不能让用户填写网上取得的私有接口 key。官方说明还要求 `app_key` 不固定在客户端、播放地址支持 302，并限制服务端缓存及客户端下载。

### 酷狗音乐

[官方曲库开放组件](https://open.kugou.com/docs/open-player/) 提供 Android/iOS 播放 SDK、按有效播放次数计费、仅在线播放，并要求界面注明酷狗技术支持。它不是匿名免费全曲 FLAC API；公开组件介绍也没有承诺返回 FLAC/Hi-Res 或保证某个采样率。[官方商务合作页](https://www.kugou.com/about/business.html) 另外列有车载 APK/SDK 等合作方案。

适合度：面向 Windows Electron/PWA 的本应用需另行确认合作和平台支持。不能因酷狗消费端存在无损音质，就把移动端开放组件视为可直接复用的无损下载接口。

### Qobuz

[官方音质说明](https://help.qobuz.com/en/articles/214414-why-choose-qobuz) 说明订阅包含 FLAC 16 bit / 44.1 kHz 与最高 24 bit / 192 kHz 高解析度；具体曲目仍以提供的母带为准。[官方下载格式说明](https://help.qobuz.com/en/articles/10167-what-are-the-different-audio-formats-available-for-download) 说明付费购买文件可提供 FLAC/ALAC/WAV/AIFF 等无 DRM 格式，适合用户购买后本地导入。

官方仍可访问的 [API Terms of Use](https://static.qobuz.com/apps/api/QobuzAPI-TermsofUse.pdf) 要求 Qobuz 签发的 Application ID 与 Application secret，并限制设备、用户范围、地区及分发方式。但该 PDF 生效日期为 **2011-09-01**，只能作为明确存在获批应用凭据要求的证据，不能据它推断当前仍开放个人自助申请或沿用所有旧流程。本次没有找到足以证实“个人开发者可立即自助获得完整播放权限”的新官方公开承诺。

适合度：当前提供官方入口及已购买文件的本地播放。完整曲库集成需要向 Qobuz 确认当前合作申请及适用条件，不抓取官网应用密钥，也不使用第三方代解接口。

### TIDAL

[官方音质文档](https://support.tidal.com/hc/en-us/articles/17412130162961-HiRes-FLAC-audio) 区分 High：FLAC 16 bit / 44.1 kHz，以及 Max：最高 24 bit / 192 kHz HiRes FLAC。音质取决于具体曲目和支持的客户端/合作设备。

[当前官方 API/SDK 概览](https://developer.tidal.com/documentation/api-sdk/api-sdk-overview) 明确：第三方应用播放必须使用官方未修改的 Player 模块，公开开发者能力可播放 **previews**。SDK 包含内部应用使用、尚未向外部开发者开放的能力，不能把公开 SDK 源码等同于完整歌曲授权。

[官方鉴权文档](https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization) 使用 OAuth 2.1，应用须取得 access token；用户授权使用授权码和 PKCE。应用注册凭据与用户账号授权是不同环节，用户持有订阅也不会自动把普通第三方 app 升级成获批完整 Hi-Res 播放客户端。

适合度：当前提供官方入口。若做目录或试听集成，走注册应用、OAuth 和官方 Player，明确标为试听；完整无损播放需另行取得相应合作权限，不能承诺“登录即全曲 Hi-Res”。

## 推荐实施顺序

1. 上线前在应用内接好四个 Radio Paradise CD 无损直播频道，处理无限时长、停止/重连、平台兼容与真实质量标签。此处“接好”仅指本地实现和验证，发布需另行授权。
2. 增强用户本地 FLAC/ALAC/WAV 文件播放和源格式识别，为购买的 Qobuz/2L 文件提供入口。
3. QQ 音乐、Qobuz、TIDAL 以“官方平台”入口展示；没有获批播放能力时不放进可直接解析的来源选择器。
4. 后续再核实 Radio Calico 地区规则，以及商业平台合作资格。不要用未经证实的聚合、破解或私有接口填补不可用项。
