# BiliMusic 设计与音源说明

## 从参考图到两端界面

参考图把曲目列表、封面播放、逐行歌词和 UP 主详情拆成连续的手机页面。BiliMusic 保留这条使用路径。手机上轻触底部迷你播放器可展开播放详情，切换歌词后为歌词留出整段滚动空间。桌面上把资料库、内容区与播放详情并排摆放，切换作者或专辑时仍能看见正在播放的曲目。

参考图中的「Aprdeci」线索与 AprDeci 的跨平台 B 站播放器相符。本次以该项目作界面语境参考，并把用户所说的 DLMusic、SQMusic 分别按功能对应到 Go Music DL、Simple SQ Music Plus 及同作者的 flutter_sqmusic。实现使用独立的界面、音源模型、音频桥与应用标识。[AprDeci/bili-music](https://github.com/AprDeci/bili-music) · [Go Music DL](https://github.com/guohuiyuan/go-music-dl) · [Simple SQ Music Plus](https://github.com/59799517/simple_sq_music_plus)

| 界面 | 设计决定 |
| --- | --- |
| 音源搜索 | 哔哩哔哩、酷我和网易云分别搜索，再选曲目、UP 主、歌手或专辑。粘贴平台详情链接可直接打开实体。 |
| 资料库 | 一首歌与其创作者、合集、专辑分别收藏。以平台、类型和 ID 三项共同标识，重名作品或编号相同的实体可独立管理。 |
| 播放详情 | 播放器展示当前音轨的编码或码率。网络来源缺少歌词时显示实际状态，器乐试听标明器乐曲。 |
| 调音台 | 封面和歌词页保留听歌操作，调音时才展开十段频率、预设、前级和限幅。开关可用于即时对比。 |

当前布局与交互见 [macOS 风格播放页](player-design.md)。

## 沉浸歌词

歌词与队列位于播放页右侧，封面与播放控制保留在左侧。当前歌词用深色强调，其他歌词保持清晰灰字，取消模糊、渐变背景及滚动动画。小窗口改为纵向布局，歌词与列表独立滚动。

中文注音由随包的 pinyin-pro 逐行计算。外语歌曲在音源提供译文时按时间配对；原文、注音和译文可分别选择，显示偏好保存到本机。[注音词库与许可](../src/vendor/pinyin-pro/PROVENANCE.md)

## 参考仓库与实际选型

| 参考内容 | BiliMusic 中的用途 |
| --- | --- |
| Go Music DL 与 music-lib 的 B 站适配 | 交叉核对按 BV 读取元数据、分 P 与音频解析的分工。应用直接使用本机网络桥请求平台。[Go Music DL](https://github.com/guohuiyuan/go-music-dl) · [music-lib 的 B 站适配](https://github.com/guohuiyuan/music-lib/tree/7cc4467b4e30/bilibili) |
| SQMusic 的酷我适配 | 核对歌曲、歌手、专辑、音质请求与逐行歌词的数据结构。[flutter_sqmusic 的 KuwoController](https://github.com/59799517/flutter_sqmusic/blob/cb805c5d1796/lib/controller/KuwoController.dart) · [Simple SQ Music Plus 的酷我模块](https://github.com/59799517/simple_sq_music_plus/tree/3c2599d47a7c/src/main/java/com/sqmusicplus/v3/plug/kw) |
| BBPlayer 与 AprDeci/bili-music | 比较从搜索或本地资料库进入播放队列、歌词及 UP 主详情的操作。[BBPlayer](https://github.com/bbplayer-app/BBPlayer) · [AprDeci/bili-music](https://github.com/AprDeci/bili-music) |
| yt-dlp 的 Bilibili extractor | 交叉核对 WBI 签名、DASH 音轨及备用播放地址。[Bilibili extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py) |
| Listen 1 与 FeelUOwn 的酷我适配 | 交叉核对酷我目录标识与歌词接口，再用实际请求验证字段和媒体内容。[Listen 1](https://github.com/listen1/listen1_chrome_extension/blob/master/js/provider/kuwo.js) · [FeelUOwn](https://github.com/feeluown/feeluown-kuwo/blob/master/fuo_kuwo/api.py) |

本地 AppleMusic 工程的 `src/inject/dsp.js` 提供了均衡频率、Q 值和预设参考。BiliMusic 的真实音频链为媒体输入、前级、十段峰值 EQ、可选限幅与总音量。关闭 DSP 后仍可调总音量。

## 音质与回落

视频投稿从平台返回的 DASH 中依次选择设备能解码的 FLAC、Dolby、普通音频。同一音轨优先使用平台源站 CDN，播放失败时依次尝试备用地址和下一种编码。AU 音频区投稿单独解析。歌词优先读取 AU 自带时间轴；BV 视频可读取平台开放的字幕。

酷我按曲目 RID 请求无损，再核对返回 RID、编码、下载地址和试听标志。无损不可用时请求平台允许的较低音质。播放器识别并拒绝返回另一 RID 的提示音。目录数据和临时播放地址分开处理，每次点播重新解析。

酷我采用 Simple SQ Music Plus 3.0 所用的官方访客接口和音质档位，按同一 RID 收集合法可用的 FLAC、320 和 128 kbps 备选。上游配置中与旧版 APK 绑定的专属渠道参数未用于取得额外权益。[SQMusic 播放入口](https://github.com/59799517/simple_sq_music_plus/blob/3c2599d47a7c82b85607a7d1d063fd03e546bbf6/src/main/java/com/sqmusicplus/v3/plug/kw/hander/NKwSearchHander.java#L500-L525) · [上游配置](https://github.com/59799517/simple_sq_music_plus/blob/3c2599d47a7c82b85607a7d1d063fd03e546bbf6/src/main/resources/application-kw.yml)

网易云按歌曲 ID 解出平台提供的音频，核对实际格式、码率和试听时长。歌词保留来源的译文或罗马音。热评和最新评论也以这个 ID 拉取，打开评论不依赖该歌曲能否播放。

## 内置试听素材

《山间来信》由三首合成器小品组成。音频生成代码在 `scripts/make-session.py`，成品为双声道 16 bit / 44.1 kHz FLAC。三曲共享一张 EP 封面。

封面为内置 ImageGen 生成的原创山谷风景，项目文件在 `src/assets/forest.jpg`。封面文字由应用排版。生成提示词如下。

```text
Use case: photorealistic-natural. Asset type: premium instrumental record sleeve photograph for an independent Chinese music listening application, landscape 3:2 frame. A deep alpine forest valley of dark pine and spruce, layered emerald mountains rise steep on both sides, a wide river of soft white morning mist runs diagonally into the far center-right, right-hand treeline as dramatic silhouette, the ridge above glows with very pale apricot sunlight. Foreground lower left dark pine forest. Authentic analogue medium-format landscape photograph, finely textured film grain, dark teal green lower half, luminous grey sage sky, evocative rainy quiet mood, premium editorial cover. The photograph must work both cropped square and wide panoramic. No typography, no vinyl record, no frames, no logos, no people, no watermarks.
```
