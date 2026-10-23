# Cap ve Loom Karşılaştırma Araştırması (Ekim 2026)

> Hazırlanma tarihi: 23 Ekim 2026. Amaç: Umi (ücretsiz, native macOS, Swift/SwiftUI, ScreenCaptureKit, macOS 15+) için kapsam belirlemek.
> Umi'nin kapsamı: **kayıt, kayıt sırasındaki araçlar, düzenleme, paylaşım (dosya + link), izleyici sayfası**.
> **AI** ve **ekip/çalışma alanı** özellikleri sadece kısaca listelenmiş ve **"kapsam dışı"** olarak işaretlenmiştir.
>
> Doğrulama notu: Bilgiler resmi sayfalardan (cap.so, cap.so/docs, GitHub, loom.com, support.atlassian.com/loom) alındı. Resmi kaynakta bulunamayan ya da sadece üçüncü taraf / eski kaynakta geçen bilgiler **(doğrulanamadı)** veya **(üçüncü taraf)** ile işaretlendi.

---

## 0. Kısa Özet

| Konu | Cap | Loom |
|---|---|---|
| Konumlandırma | Açık kaynak Loom alternatifi; "Instant" (Loom tarzı) + "Studio" (Screen Studio tarzı düzenleme) | Asenkron video mesajlaşma; Atlassian'a ait; ekip/satış odaklı |
| Platform | macOS 13.1+ (Apple silicon + Intel), Windows 10+, Linux (.deb), Chrome eklentisi, iOS, CLI, MCP | macOS, Windows, Chrome eklentisi, iOS, Android |
| Teknoloji | Rust (kayıt/encode/render crate'leri) + Tauri v2/SolidStart (desktop), Next.js (web). 0.6.1 ile "tamamen native" (GPUI) | Kapalı kaynak |
| Lisans | AGPLv3 (varsayılan); `cap-camera*` ve `scap-*` crate'leri MIT | Ticari |
| Güçlü yan | Studio editörü: auto zoom, arka plan/padding, cursor smoothing, sahneler, captions, GIF export | Hızlı link, olgun izleyici sayfası (CTA, reply, analitik), entegrasyonlar |
| Zayıf yan | Genç ürün, performans/RAM hataları, Windows çoklu monitör hataları | Editör zayıf (trim/stitch), ücretsiz plan 5 dk / 25 video / 720p, Atlassian sonrası fiyat şikayetleri |
| Ücretsiz plan | Kişisel kullanım ücretsiz, Studio sınırsız; bulut linkleri kısıtlı | 25 video, 5 dk, 720p |

Kaynaklar: https://cap.so, https://github.com/CapSoftware/Cap, https://www.loom.com/pricing

---

## 1. Cap (cap.so)

### 1.1 Kayıt (Recording)

**Modlar** (https://cap.so, https://cap.so/docs/recording/studio-mode):
- **Instant Mode**: "Hit record and Cap uploads as you go." Kayıt sırasında veri yüklenir, durdurunca işlem tamamlanır ve link panoya kopyalanır. Zaman çizelgesi düzenlemesi **yok**; sonrasında sadece yeniden adlandırma, erişim ayarları, klasörleme, link kopyalama, silme (https://cap.so/docs/recording/instant-mode).
- **Studio Mode**: Yerel kayıt, 4K'ya kadar, **ekran / kamera / mikrofon ayrı track'ler** halinde. Durdurunca editör açılır. Kayıt düzenlenebilir `.cap` proje paketi olarak yerelde kalır; link sadece export ekranında "Shareable Link" seçilirse oluşur.
- **Screenshot Mode**: Pencere veya alan yakalama (hotkey), ardından arka plan/padding/köşe/gölge ile "güzelleştirme", ok/şekil/metin/maske ile annotasyon, panoya kopyalama veya kaydetme. 0.5.3 ile anotasyonu korunmuş screenshot paylaşım sayfaları (https://cap.so/changelog).

**Hedefler**: Display (tam ekran), window, area (alan), **camera-only** (https://cap.so/docs/recording/studio-mode). 0.5.7 ile **tekrar kullanılabilir alan presetleri** (area presets) eklendi.

**Çözünürlük / FPS**: Studio "up to 4K"; export 4K/60fps (https://cap.so/pricing). 0.5.6 ile **24 ve 25 FPS** yakalama seçeneği eklendi; 0.6.1 ile 5K/6K ekran desteği ve BT.709 export renkleri (https://cap.so/changelog). Kesin kayıt FPS seçenek listesi dokümanda yok **(doğrulanamadı)**; üçüncü taraf inceleme "4K, 60 fps" diyor (https://www.screensnap.pro/blog/cap-so-review).

**Ses kaynakları**: Mikrofon (dahili, USB, ses kartı; seviye göstergesi ile), **sistem sesi** (https://cap.so/docs/recording/camera-and-mic). 0.5.8: mikrofon olmadan kayda başlarken onay uyarısı. 0.5.6: Instant mode'da kayıt ortasında mikrofon susturma. 0.6.0: "Studio Sound" gürültü azaltma.

**Kamera balonu**:
- Kayıt sırasında: varsayılan daire; boyut ayarlanabilir; köşelere sürüklenebilir; kamera seçimi hatırlanır, yeniden takılınca otomatik devam (https://cap.so/docs/recording/camera-and-mic).
- Editörde (Studio): özel veya preset konum (köşeler/kenarlar), gizle, **ayna**, hafif/yoğun **arka plan bulanıklığı**, kare veya kaynak şekilli çerçeve, boyut, köşe yuvarlaklığı, gölge, zoom sırasında ölçeklen/sabit kal (https://cap.so/docs/recording/studio-mode). 0.6.0: macOS'ta kamera arka plan bulanıklaştırma/kaldırma.
- Diğer şekiller (kare/dikdörtgen vb.) kayıt sırasında **(doğrulanamadı)**.

**Pause / resume / restart**: Her iki modda pause, resume, restart, stop var (https://cap.so/docs/recording/instant-mode). Pause'un zaman çizelgesine etkisi belgelenmemiş.

**Maksimum uzunluk**: Studio'da sınır yok (yerel). Bulut linkleri: Free ve Desktop License'ta link başına **5 dk**, Desktop License'ta ayda 20 link; Pro'da sınırsız (https://cap.so/pricing). 0.5.9 ile tüm modlarda disk alanı kontrolü.

**Hotkey'ler**: **Varsayılan kısayol yok**; hepsi Settings > Shortcuts'tan atanır: kayıt seçici (display/window/area), stop, restart, pause/resume, mod değiştirme, screenshot (display/window/area). Çakışmalarda farklı tuş önerisi (https://cap.so/docs/recording/keyboard-shortcuts).

**Çoklu monitör**: Display seçimi ile destekleniyor; 0.5.6'da çoklu monitör ölçekleme hataları düzeltildi. Windows'ta yanlış ekran seçilmesi / iki ekranın tek tuvale gerilmesi şikayetleri var (https://www.screensnap.pro/blog/cap-so-review).

**Diğer kayıt detayları** (https://cap.so/changelog):
- 0.5.7: Dahili **teleprompter**; son medyayı gösteren genişletilebilir capture penceresi.
- 0.5.8: Yüzen panellerin macOS kayıtlarından hariç tutulması (Cap'in kendi UI'ı kayda girmez).
- 0.5.9: Studio'da opsiyonel **MacBook notch overlay** (crop/padding/zoom'u takip eder); kayıt ortası yazıcı hatalarına dayanıklılık.
- 0.6.1: Crash recovery ve kayıt senkron düzeltmeleri; CPU/RAM kullanımında büyük düşüş.
- 0.5.4: Özel kayıt klasörü.

### 1.2 Kayıt Sırasında (In-recording)
- Kontroller: pause/resume/restart/stop/delete. Chrome eklentisi 1.0.3: sayfa üzerinde **sürüklenebilir kayıt rayı** (pause, restart, delete) ve kamera balonu yeniden boyutlandırma.
- **Çizim/annotasyon kayıt sırasında**: Resmi dokümanda yok **(doğrulanamadı)**. Cap'in yaklaşımı efektleri **sonradan** (editörde) uygulamak: click efektleri, zoom, maskeler, metin, klavye track'i.
- Cursor vurgusu kayıt sırasında değil, editörde render edilir (cursor metadata ayrı kaydedilir).
- Geri sayım: resmi dokümanda bulunamadı **(doğrulanamadı)**.
- Konfeti vb.: yok (bulunamadı).

### 1.3 Düzenleme (Studio Editor)
Kaynak: https://cap.so/docs/recording/studio-mode ve https://cap.so

**Timeline / klipler**
- Trim, playhead'de split, sil, yeniden sırala, yeniden adlandır.
- Başka Studio kaydı ekleme, Cap kaydı veya **MP4 içe aktarma** (klip birleştirme). 0.5.3: editör içinden yeni klip kaydı.
- Segment hızı: 0.25x, 0.5x, 1x, 1.5x, 2x, 4x, 8x. Hız değişiminde ses: sessiz, doğal ses perdesi korunur veya perde kayar.
- Mikrofon / sistem sesi / kamera için manuel senkron offset.
- Geçişler: crossfade, fade-through-black (süre ayarlı).
- Undo/redo; orijinal dosyalar değişmez (non-destructive).
- 0.6.0: klip sağ tık kontrolleri, export boyut tahmini.

**Zoom track**
- 1x – 4.5x.
- **Auto mode**: kaydedilen tıklamalardan otomatik zoom üretimi (cursor metadata gerekir; içe aktarılan MP4'te yok).
- **Manual**: odak noktası belirleme, segmentleri taşıma/boyutlandırma. 0.5.4: daha yumuşak cursor ve zoom hareketi.
- 0.6.0: **3D kamera hareketleri** (tilt, glide, sweep, pull-back + focus blur).

**Sahne (Scene) track** (kamera gerekir)
- Default, Camera Only, Hide Camera, Split Screen (dikeyde otomatik üst üste), Floating (arka plan üzerinde yuvarlak kartlar). Her sahne için ayrı giriş/çıkış geçiş süresi. 0.5.4: snapping ile manuel sahne yerleşimi.

**Tuval ve ekran stili**
- En-boy: Auto, 16:9, 9:16, 1:1, 4:3, 3:4.
- Crop ve konumlandırma (0.5.3: canlı crop önizleme).
- Arka plan: düz renk, gradient, hazır duvar kağıdı, özel görsel (+ blur).
- Padding (%0–40), köşe yuvarlaklığı, motion blur, kenarlık (kalınlık/renk/opaklık), gölge (boyut/opaklık/blur).
- Çerçeveler: yok, macOS/Windows pencere, tarayıcı (düzenlenebilir URL/başlık), MacBook bezel.
- Renk düzenleme (0.6.0): 8 preset (Cinematic, Noir, Vintage, Frost, Golden, Midnight, Vivid, Dreamy) + pozlama, kontrast, vinyet.

**Cursor kontrolleri** (cursor verisi gerekir)
- Göster/gizle, boyut, eğim (tilt), dairesel cursor.
- Belirli süre hareketsizlikte otomatik gizleme.
- Hareket: ham veya yumuşatılmış (Slow, Smooth, Mellow, Fast, özel: tension/friction/mass) — yay (spring) fiziği.
- Desteklenen cursor'lar yüksek kaliteli **SVG** olarak yeniden çizilir.
- Click efektleri ve motion blur (https://cap.so).

**Maske track'leri**: Hassas alan (blur/pixelate, şiddet ayarlı), Highlight (dışarıyı karartma, karartma ve fade ayarlı). Sabit dikdörtgen; hareketli içeriği takip etmez.

**Metin track'leri**: Çoklu şerit; font boyutu, kalınlık, italik, renk, marka renkleri, fade, konum. 0.6.0: animasyonlu metin (başlıklar, lower third, istatistik, typewriter).

**Klavye track'i (Beta)**: Kaydedilen tuş vuruşlarını ekranda gösterme; font/renk/konum/fade/linger, modifier ve özel tuş seçenekleri.

**Altyazı (Captions, Beta)**: **Yerel** transkripsiyon (Parakeet; Intel Mac'te Whisper), 19 dil, stil presetleri, aktif kelime vurgusu, animasyon; export'a yakılır (burn-in); **SRT/WebVTT** dışa aktarma (https://cap.so/docs/recording/studio-mode, https://cap.so). Not: yerel model tabanlı ama "AI" sayılabilir; Umi için yerel Apple Speech/Whisper değerlendirilebilir.

**Ses track'leri**: Müzik/SFX için çoklu şerit, dahili kütüphane, MP3/WAV/M4A/OGG/FLAC/AAC içe aktarma, segment başına ses/fade; mikrofon kanal modu (stereo / sol mono / sağ mono).

**Presetler**: Stil presetleri oluşturma, varsayılan atama; timeline'ı bozmadan uygulama.

**Export**

| Format | Seçenekler |
|---|---|
| MP4 | 720p / 1080p / 4K; 15 / 30 / 60 FPS; kalite presetleri veya özel bits-per-pixel; dosya boyutu optimizasyonu |
| GIF | 720p / 1080p; 10 / 15 / 20 / 25 / 30 FPS |
| Cursor-only MOV | Şeffaf; sadece cursor hareketi ve tıklamalar; dosya veya pano |

Hedefler: yerel dosya, pano, Cap linki (link sadece MP4, oturum açma gerekir). (https://cap.so/docs/recording/studio-mode)

**Web tarafı düzenleme**: Transcript ile düzenleme — kelime kelime senkron, metin silince görüntü kesilir, dolgu kelimeleri vurgulanır (Temmuz 2026, https://cap.so/changelog). (Transcript tabanlı olduğu için AI'ya bağlı; Umi için sonraki aşama.)

### 1.4 Paylaşım
Kaynak: https://cap.so/docs/sharing/share-a-cap

- **Instant link**: Instant Mode'da kayıt sırasında yükleme; durdurunca link hazır olunca panoya. Studio'da export'tan link.
- URL: `https://cap.so/s/<id>`; embed: `https://cap.so/embed/<id>`; self-host'ta kendi domain.
- Erişim: **Public**, **Private** (oturum + yetki/e-posta daveti), **Password** (Pro). E-posta ile davet (koltuk gerektirmez). "Yeni kayıtları private başlat" org ayarı.
- **Link süresi dolması (expiry)**: belgelenmemiş **(doğrulanamadı / muhtemelen yok)**.
- **İndirme izni**: "Download controls" var; organizasyon videolarında indirme açık paylaşım gerektiriyor (Ağustos 2026 erişim kontrolleri, https://cap.so/changelog).
- **Özel domain**: Pro (https://cap.so/pricing).
- **Embed**: iframe; query parametresi/özelleştirme belgelenmemiş; autoplay garanti değil; şifreli videoda embed'de şifre istemi (https://cap.so/docs/sharing/embeds).
- **Depolama**: Cap Cloud, **kendi S3-uyumlu bucket** (AWS S3, R2, B2, MinIO, Wasabi), Google Drive, sadece yerel. Self-host: `docker compose up -d` (https://github.com/CapSoftware/Cap, https://cap.so/docs/s3-config).
- Rich link önizlemesi (başlık+thumbnail unfurl), "copy as rich link" (Temmuz 2026). Slack unfurl + inline player (Temmuz 2026).
- Loom importer: Loom linki veya CSV ile kütüphane taşıma (Pro).

### 1.5 İzleyici Sayfası
Kaynak: https://cap.so/docs/sharing/share-a-cap, /comments, /analytics
- Oynatma, scrubbing, tam ekran, ses, yapılandırılmış **oynatma hızları**.
- Altyazı ve transcript (varsa); Instant kayıtlarda **yükleme sırasında canlı transkripsiyon** (Ağustos 2026).
- Özet ve bölümler (chapters) — AI, kapsam dışı.
- **Zaman damgalı yorumlar**, cevaplar, **emoji reaksiyonları** (gönderim için oturum gerekir; kapatılabilir; e-posta/uygulama içi bildirim).
- İndirme kontrolleri, sahip/org markalaması.
- Kalite seçici ve **CTA butonu belgelenmemiş** (muhtemelen yok).
- **Analitik**: video başına izlenme (benzersiz oturum), yorum, reaksiyon; org düzeyinde zaman serisi, ülke/şehir/tarayıcı/OS/cihaz kırılımı. "Kim, ne kadar izledi" dokümanın giriş sayfasında geçiyor. Pro özelliği (https://cap.so/pricing).
- Hesapsız izleme: "No download, no account."

### 1.6 Fiyatlandırma (https://cap.so/pricing)
- **Free ($0)**: Kişisel kullanım; Studio + tam editör, 4K/60 export; link başına 5 dk. (Sayfadaki karşılaştırma tablosu ile giriş metni arasında çelişki var.)
- **Desktop License**: $29/yıl veya $58 tek sefer. Ticari kullanım, sınırsız yerel kayıt/düzenleme, ayda 20 bulut linki (her biri ≤5 dk).
- **Cap Pro**: $12/kullanıcı/ay (yıllık $8.16/ay). Sınırsız bulut, şifre, özel domain, analitik, AI, özel S3/Drive, Loom importer.
- **Enterprise**: Pro + SAML SSO ($199/ay), BAA ($99/ay), SCIM.

### 1.7 Kapsam Dışı (Cap) — kısaca
- **AI (kapsam dışı)**: otomatik başlık, özet, tıklanabilir bölümler, transcript arama, transcript ile düzenleme, AI ajan entegrasyonu (CLI, MCP 76 araç, REST API, webhooks).
- **Ekip (kapsam dışı)**: team workspaces, spaces/folders, toplu taşıma, SSO/SCIM, SOC 2 / ISO 27001 / HIPAA, Slack entegrasyonu, desktop otomasyonları.

### 1.8 Kopyalanmaya Değer UX Detayları (Cap)
1. **İki modlu model**: hızlı "Instant" + cilalı "Studio" — kullanıcı kayıttan önce seçiyor, mod hotkey ile değiştirilebilir.
2. **Ayrı track kaydı** (ekran/kamera/mic) + **cursor metadata ayrı kaydı** → kamera konumu, cursor boyutu/gizleme, zoom tamamen sonradan değiştirilebilir. Bu, Studio editörünün temelidir.
3. Cursor'un **SVG ile yeniden çizilmesi** ve **spring fiziği** ile yumuşatma (tension/friction/mass).
4. **Auto zoom tıklamalardan** + manuel override; zoom sırasında kamera ölçeklenme seçeneği.
5. Kayıt UI'ının (yüzen paneller) kayda girmemesi.
6. Stil **presetleri** ve varsayılan preset.
7. Export boyut tahmini, panoya export, cursor-only şeffaf MOV.
8. Crash recovery ve disk alanı kontrolü.
9. Mikrofonsuz kayda başlarken uyarı.
10. Rich link unfurl (OG tags) — Slack/iMessage'da thumbnail.

### 1.9 Yaygın Şikayetler (Cap)
- Performans: render edilen videoda titreme ve oynatma takılması, **~15GB RAM** kullanımı, açılışta donma (GitHub en çok tepki alan issue'lar: https://github.com/CapSoftware/Cap/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc). 0.6.1 "fully native" sürümü CPU/RAM'i düşürdüğünü iddia ediyor.
- Çekirdek kayıt hataları: Instant'ta "start recording" butonunun tepkisiz kalması, Studio'da mikrofon sesinin kaydedilmemesi (GitHub).
- macOS'ta masaüstünde "Inspect Element" bağlam menüsü (Tauri/webview kökenli; GitHub).
- Windows çoklu monitör hataları; genç ürün olduğu için sık küçük hatalar; ticari kullanım için lisans gerekmesi (https://www.screensnap.pro/blog/cap-so-review — rakip firma yazısı).
- İstekler: HEVC export, webcam-only mod, kareyi PNG export, Linux/Wayland, Homebrew.

---

## 2. Loom (loom.com)

### 2.1 Kayıt
Kaynak: https://support.atlassian.com/loom/docs/get-started-with-loom-for-macos

**Modlar (macOS desktop)**: Record display, Record window, Record custom size (alan), Record camera only, Record for agent (AI, kapsam dışı). Capture modları: Screen and camera, Screen-only, Camera-only, Avatar (https://support.atlassian.com/loom/docs/choose-your-recording-mode/).

**Çözünürlük**: 720p / 1080p / 1440p / 4K; Starter **720p** ile sınırlı, Business ve üstü 4K'ya kadar (https://www.loom.com/pricing). FPS seçeneği belgelenmemiş **(doğrulanamadı)**.

**Ses**: Mikrofon seçimi / mic yok; çok yüksek sesle konuşunca kırmızıya dönen dalga formu; **sistem sesi** dahil etme; arka plan gürültü filtresi.

**Kamera balonu**:
- **5 boyut** (hover ile slider); Chrome eklentisinde 3 boyut.
- **Şekiller**: squircle, daire, yatay dikdörtgen, dikey dikdörtgen.
- **Filtreler**: None, Vivid, Mono, Chrome, Warm, Vibey, Rainbow (Cmd-click ile döngü).
- Serbest sürükleme, köşe/kenarlara **snap**, konum hatırlanır.
- Kayıt sırasında **çift tıklayınca tam ekran kamera**.
- Sanal arka planlar, kamera çerçeveleri, kamera çevirme (https://support.atlassian.com/loom/docs/choose-your-recording-mode/); Business'ta blur (https://www.loom.com/pricing).

**Diğer kayıt ayarları**:
- **Countdown** (kısa geri sayım; Chrome'da 3 sn).
- **Hide system UI**: menü çubuğu, Dock, masaüstü widget'larını kayıttan gizler.
- **Speaker notes**: sadece kaydedene görünen, otomatik kayan notlar (hız ayarlı) — teleprompter.
- **Canvas**: arka plan/şablon + metin düzeni (kamera-only/sunum için).
- Arka planlar: preset desen, damlalık ile renk, görsel yükleme.
- Business: özel kayıt boyutları, **Do not disturb**, çizim aracı, mouse vurgusu, blur.
- Çoklu monitör desteği var (https://support.atlassian.com/loom/docs/choose-your-recording-mode/); detay **(doğrulanamadı)**.

**Pause/restart/cancel** ve **varsayılan hotkey'ler** (https://support.atlassian.com/loom/docs/use-looms-keyboard-shortcuts/, https://support.atlassian.com/loom/docs/pause-and-resume-while-recording/):

| İşlem | macOS | Windows |
|---|---|---|
| Başlat/Durdur | Cmd+Shift+L | Ctrl+Shift+L |
| Pause/Resume | Opt+Shift+P | Alt+Shift+P |
| Hızlı restart | Cmd+Shift+R | Ctrl+Shift+R |
| Çizim | Cmd+Shift+D | Ctrl+Shift+D |
| İptal | Opt+Shift+C | Alt+Shift+C |
| Konfeti | Ctrl+Cmd+C | Ctrl+Alt+C |

Kısayollar özelleştirilebilir; sadece QWERTY destekleniyor.

**Maksimum uzunluk**: Starter **5 dk** (ve 25 video/kişi); Business ve üstü sınırsız. Chrome eklentisi 2 saatte bir "hâlâ kaydediyor musun" kontrolü (https://support.atlassian.com/loom/docs/how-long-can-i-record/).

### 2.2 Kayıt Sırasında
- **Çizim aracı** (desktop, Business): çizgi/ok/daire; renk ve kalınlık ayarlı; çizimler **5 sn sonra kendiliğinden kaybolur** (https://community-link.atlassian.com/learning/lesson/create-more-engaging-videos-with-advanced-recording-features-in-loom).
- **Mouse tıklama vurgusu** (desktop): her tıklamada **sarı daire**; Settings > Video & audio, kalıcı tercih (https://support.atlassian.com/loom/docs/highlight-your-mouse-clicks/).
- **Konfeti** (desktop): kısayol ile ekrana konfeti (detay sayfası alınamadı; kısayol doğrulandı).
- Kontrol UI'ı: kayıt sırasında toolbar gizlenir; start-stop ikonu üzerinde hover ile kontroller (pause, restart, çizim, iptal). Durdurunca sol altta thumbnail önizleme.
- Kayıt sırasında trim ("Trim your video while recording" yardım makalesi var, içerik **doğrulanamadı**).

### 2.3 Düzenleme
Kaynak: https://support.atlassian.com/loom/docs/edit-your-loom-video/, https://www.loom.com/pricing
- **Waveform trim** (Business+): baş/son tutamaçları, ortadan split + sil, "Fit" ile yakınlaştırma; klip başına 500 trim; ≤5 saatlik videolar.
- **Stitch** (Business+): başka Loom'u başa/sona/zaman damgasına ekleme, sıralama; orijinal değişmez; izleyiciye stitch izni verilebilir.
- **Özel thumbnail** (Business+), **GIF thumbnail** (tüm planlar).
- **Gömülü linkler / CTA** (aşağıda).
- **Metin/kutu/ok overlay'leri**, gelişmiş düzenleme — **Business + AI**.
- **Edit by transcript**, dolgu kelime / sessizlik kaldırma, otomatik video iyileştirme — AI, **kapsam dışı**.
- Altyazı (closed captions) — transkripsiyona bağlı, 50+ dil.
- **Yok / bulunamadı**: auto zoom, arka plan/padding/köşe/gölge stillendirme, cursor yumuşatma/boyut, hız segmentleri, en-boy oranı değişimi, kamera düzeni sonradan değiştirme. Loom editörü "ince" olarak eleştiriliyor (https://trainn.co/blog/loom-reviews/).
- **Export**: Business+ planlarda indirme (MP4 olduğu yaygın kabul ediliyor, resmi format belgesi **doğrulanamadı**); GIF export yok (sadece GIF thumbnail).

### 2.4 Paylaşım
- **Instant link**: Durdurunca link panoya kopyalanır, "buffering/processing/rendering yok" pazarlama iddiası (https://www.loom.com/products/screen-recording-app). Kayıt sırasında yükleme mekanizması resmi olarak belgelenmemiş **(doğrulanamadı, muhtemelen evet)**.
- **Gizlilik**: "Anyone with the link" (hesapsız izleme), workspace üyeleri, sadece eklenen e-postalar; admin varsayılanları; paid planlarda public linkleri kapatma (https://support.atlassian.com/loom/docs/use-looms-privacy-settings/).
- **Şifre**: Business+ (şifreli videolar Spaces'e eklenemez) (https://support.atlassian.com/loom/docs/protect-your-videos-with-a-password).
- **Expiry**: bulunamadı. Enterprise'da özel saklama (retention) politikaları.
- **İndirme izni**: video başına aç/kapa; Enterprise'da indirme kısıtlama kontrolü.
- **Özel domain**: yok (pricing'de geçmiyor).
- **Markalama** (Business+): Loom markasını kaldırma, logo, oynatıcı renkleri.
- **Embed**: iframe + parametreler `autoplay=1`, `hide_owner=true`, `hideEmbedTopBar=true`, `hide_share=true`, `t=1m20s` (https://support.atlassian.com/loom/docs/embed-your-video-into-a-webpage/).
- **S3/özel depolama**: yok.
- Entegrasyonlar (Slack, Jira, Confluence, GitHub, Gmail, Notion...) — ekip odaklı, kapsam dışı.

### 2.5 İzleyici Sayfası
Kaynak: https://support.atlassian.com/loom/docs/edit-your-video-settings-disable-comments-emoji-reactions-downloads-and-more/
- **Önerilen oynatma hızı** (varsayılan 1.2x; 0.8x–2.5x arası; izleyici değiştirebilir).
- **Yorumlar** (video altında; e-posta bildirimi) ve **emoji reaksiyonları** (gerçek zamanlı; oynatıcıda son 50 gösterilir).
- **Record a Reply**: izleyicinin kendi Loom'uyla cevap vermesi.
- **İzlenme sayısını izleyiciye gösterme** seçeneği.
- Transcript görünürlüğü, altyazılar, AI bölümler/özet (kapsam dışı).
- **CTA butonu** (Education/Business+): metin + URL, renk/şekil/konum; varsayılan CTA; embed'de sağ üstte sabit; Auto CTA (Business+AI) (https://support.atlassian.com/loom/docs/add-and-edit-a-call-to-action-button/).
- Animasyonlu GIF thumbnail, "Loom branded player" (giriş/kayıt isteme).
- **Analitik**: Starter'da viewer insights; Business'ta engagement + dışa aktarma; Enterprise'da kullanıcı bazlı indirilebilir içgörüler (https://www.loom.com/pricing).
- Watch later.
- Kalite seçici: belgelenmemiş **(doğrulanamadı)**.

### 2.6 Fiyatlandırma (https://www.loom.com/pricing)
- **Starter ($0)**: 25 video/kişi, 5 dk, 720p, 50'ye kadar üye.
- **Business ($18/kullanıcı/ay)**: sınırsız video/süre, 4K, trim/stitch, şifre, markalama, indirme.
- **Business + AI ($24/kullanıcı/ay)**: AI özellikleri, transcript ile düzenleme, overlay'ler, Auto CTA.
- **Enterprise**: satışla görüşme; SSO/SCIM, retention, indirme kısıtlama.
- Yıllık ödemede ~%17 indirim.

### 2.7 Kapsam Dışı (Loom) — kısaca
- **AI (kapsam dışı)**: otomatik başlık/özet/bölüm/görev, dolgu ve sessizlik kaldırma, video-to-text (doküman), toplantı notları, Auto CTA, "Record for agent", Avatar modu.
- **Ekip (kapsam dışı)**: Spaces, workspace varsayılanları, admin insights, SSO/SCIM, Atlassian Guard, entegrasyonlar, toplantı kaydı.

### 2.8 Kopyalanmaya Değer UX Detayları (Loom)
1. **Tek tıkla link panoda** — kullanıcı durdurduğu an yapıştırabiliyor.
2. **Kamera balonunun hover kontrolleri**: boyut slider'ı, şekil seçimi, köşe snap, konum hafızası, çift tıkla tam ekran.
3. **Hide system UI** (menü çubuğu/Dock/widget gizleme) — macOS'ta ScreenCaptureKit ile kolay uygulanır.
4. **Speaker notes** (kayan, sadece kaydedene görünen).
5. Mikrofon seviye uyarısı (çok yüksekse kırmızı).
6. **Kaybolan çizimler** (5 sn) — kayıt sırasında hızlı işaretleme, temizleme derdi yok.
7. Sarı tıklama halkası; konfeti gibi "eğlence" dokunuşları.
8. İzleyici sayfasında **önerilen oynatma hızı** (1.2x) ve zaman damgalı link (`t=`).
9. Embed parametreleri (autoplay, başlık çubuğunu gizle).
10. Animasyonlu GIF thumbnail (e-postada/unfurl'da dikkat çekici).

### 2.9 Yaygın Şikayetler (Loom)
- **Güvenilirlik**: çökme, ses senkron sorunları, başarısız yüklemeler (G2'de en çok bahsedilen eksi; https://trainn.co/blog/loom-reviews/ — rakip blog). Capterra'da hatalar, kararsızlık, yavaş yükleme (https://www.capterra.com/p/191187/Loom/).
- **Fiyat / Atlassian sonrası**: fiyat artışları, katı yenileme koşulları, ulaşılması zor destek, küçük işletmelerde maliyetin ~2 katına çıkması.
- **Ücretsiz plan kısıtları**: 5 dk, 25 video, 720p.
- **Zayıf editör**: uzun kayıtları yeniden düzenlemek zor; görsel cilalama (zoom, arka plan) yok.
- **Kilitlenme (lock-in)**: dokümanlara gömülü linklerin taşınamaması.

---

## 3. Özellik Karşılaştırma Tablosu (Kapsam İçi)

| Özellik | Cap | Loom | Umi için not |
|---|---|---|---|
| Ekran / pencere / alan / kamera-only | Var / Var / Var (+preset) / Var | Var / Var / Var / Var | MVP |
| Ayrı track kaydı | Var (Studio) | Bilinmiyor (sanmıyoruz) | MVP — editörün temeli |
| 4K kayıt | Var (ücretsiz) | Business+ | Ücretsiz farkı |
| Sistem sesi + mic | Var | Var | MVP (SCK `capturesAudio`) |
| Kamera şekil seçenekleri | Daire (kayıt), kare/kaynak (editör) | 4 şekil, 5 boyut, filtre | MVP: daire + squircle + boyut |
| Kamera bg blur | Var (macOS) | Business | v1.1 (Vision person segmentation) |
| Pause/resume/restart/cancel | Var | Var | MVP |
| Varsayılan hotkey'ler | Yok (kullanıcı atar) | Var | MVP: varsayılanlarla gel |
| Geri sayım | Belgelenmemiş | Var | MVP |
| Sistem UI gizleme | Kendi panelleri hariç | Hide system UI | MVP (kendi UI hariç) / v1.1 (Dock/menü) |
| Teleprompter / notlar | Var | Speaker notes | Sonrası |
| Kayıt sırasında çizim | Belgelenmemiş | Var (5 sn kaybolan) | v1.1 |
| Tıklama vurgusu | Editörde (render) | Kayıtta (sarı halka) | MVP: editörde render (metadata) |
| Konfeti | Yok | Var | Sonrası (eğlence) |
| Trim / split / sil | Var | Business | MVP |
| Klip birleştirme | Var (+MP4 import) | Stitch (Business) | v1.1 |
| Hız segmentleri | 0.25x–8x | Yok | v1.1 |
| Auto zoom (tıklama) | Var | Yok | **MVP (en yüksek değer)** |
| Manuel zoom segment | Var | Yok | MVP |
| Arka plan / padding / köşe / gölge | Var | Yok | **MVP** |
| Cursor smoothing / boyut / gizleme | Var (spring, SVG) | Yok | **MVP (smoothing+boyut)**, v1.1 (SVG, auto-hide) |
| Kamera düzenini sonradan değiştirme | Var (sahneler) | Yok | MVP (konum/boyut/gizle), v1.1 (sahneler) |
| En-boy oranı | 6 seçenek | Yok | v1.1 |
| Blur/pixelate maske | Var | Business (blur) | v1.1 |
| Metin overlay | Var | Business+AI | Sonrası |
| Altyazı | Yerel, burn-in, SRT/VTT | AI transkripsiyon | Sonrası (yerel Speech, AI sayılırsa kapsam dışı) |
| MP4 export kalite/fps | 720p–4K, 15/30/60 | İndirme (Business) | MVP |
| GIF export | Var | Yok | v1.1 |
| Instant link (kayıt sırasında yükleme) | Var | Var (durunca hazır) | v1.1 (MVP'de durunca yükle) |
| Şifreli link | Pro | Business | v1.1 |
| Link süresi (expiry) | Belgelenmemiş | Bulunamadı | v1.1 — **fark yaratma fırsatı** |
| İndirme izni | Var | Business | MVP |
| Özel domain | Pro | Yok | Sonrası (self-host ile) |
| Kendi S3 | Pro / self-host | Yok | v1.1 (S3/R2 BYO) |
| Embed | iframe | iframe + parametreler | v1.1 |
| Oynatma hızı | Var | Var (önerilen hız) | MVP |
| Zaman damgalı yorum / reaksiyon | Var | Var | Sonrası (viewer "sadece izler" kapsamı) |
| CTA butonu | Belgelenmemiş | Business | Sonrası |
| Analitik | Pro | Tüm planlar (farklı seviye) | Sonrası (basit izlenme sayacı v1.1) |
| OG/rich unfurl, thumbnail | Var | Var (GIF thumbnail) | MVP (OG tags) |

---

## 4. Umi için Öneriler

Önceliklendirme ilkesi: Umi'nin en güçlü farklılaşması **"Loom'un hızı + Cap Studio'nun cilası, tamamen ücretsiz ve native"** olmalı. Loom'un ücretsiz planındaki 5 dk / 720p / 25 video kısıtları ve zayıf editörü ile Cap'in performans/RAM şikayetleri (Tauri/webview kökenli, 0.6.1'de native'e geçiş) Umi'nin native Swift + Metal yaklaşımı için doğrudan fırsattır.

### En yüksek değerli Cap Studio özellikleri (sıralı)
1. **Auto zoom (tıklamalardan)** — "Screen Studio etkisi"nin %80'i budur; Loom'da yok. Ön koşul: kayıt sırasında cursor konumu + tıklama olaylarının zaman damgalı metadata olarak ayrı kaydı (CGEventTap / NSEvent global monitor). Manuel override (segment taşı/boyutlandır, odak noktası) şart.
2. **Arka plan + padding + köşe yuvarlaklığı + gölge** — uygulaması ucuz (tek Metal/Core Image kompozisyon geçişi), görsel etkisi çok yüksek; ilk izlenimi belirler.
3. **Cursor smoothing + boyut** — ham cursor yerine spring fiziği ile yumuşatma; cursor'u kayıtta gizleyip (SCK `showsCursor = false`) sonradan çizmek gerekir. Tıklama efekti (halka) aynı altyapıyla gelir.
4. **Kamera ayrı track** — sonradan konum/boyut/şekil/gizleme değiştirme; sahneler (camera-only, split) sonra.

### MVP
- **Kayıt**: display / window / alan / camera-only; sistem sesi + mikrofon (seviye göstergesi, mic yoksa uyarı); 1080p/4K, 30/60 fps; **ekran, kamera, mic, sistem sesi ayrı track** + cursor/tıklama metadata.
- Kamera balonu: daire + squircle, 3–5 boyut, köşe snap + konum hafızası, ayna.
- Kontroller: geri sayım (3 sn, atlanabilir), pause/resume, restart, cancel, stop; **varsayılan global hotkey'ler** (Loom'daki gibi; Cap'in "varsayılan yok" yaklaşımı ilk kullanımda sürtünme yaratıyor) + özelleştirme.
- Umi'nin kendi UI'ını kayıttan hariç tutma (SCK `excludingWindows`).
- Crash-safe kayıt (fragmented MP4 / segmentli yazım), disk alanı kontrolü.
- **Editör**: trim, split, segment silme, undo/redo (non-destructive proje dosyası).
- **Auto zoom + manuel zoom segmentleri**.
- **Arka plan (renk/gradient/görsel), padding, köşe, gölge**.
- **Cursor**: smoothing, boyut, göster/gizle, tıklama halkası.
- Kamera: editörde konum/boyut/şekil/gizle.
- **Export**: MP4 (H.264; 720p/1080p/4K; 30/60 fps; kalite presetleri) — VideoToolbox donanım encoder; panoya kopyala.
- **Paylaşım**: durdur → yükle → link panoda; public link, indirme izni aç/kapa, link silme/iptal.
- **İzleyici sayfası**: hesapsız izleme, oynatma hızı (önerilen hız 1.2x opsiyonel), tam ekran, `t=` zaman damgası linki, OG/Twitter meta (thumbnail + başlık) ile rich unfurl.

### v1.1
- **Instant mode**: kayıt sırasında parça parça yükleme (Cap Instant / Loom davranışı), durdurunca anında link.
- Şifreli link, **link süre sonu (expiry)** — iki rakipte de belgelenmemiş, ücretsiz bir farklılaştırıcı.
- Kendi depolaman (S3 / Cloudflare R2 BYO) — ücretsiz ürünün barındırma maliyetini de düşürür.
- GIF export (720p/1080p, 10–30 fps).
- Hız segmentleri (0.5x–4x, perde koruma).
- En-boy oranları (16:9, 9:16, 1:1, 4:3).
- Blur/pixelate gizlilik maskeleri.
- Kamera arka plan bulanıklığı (Vision person segmentation).
- Klip birleştirme / MP4 içe aktarma.
- Kayıt sırasında çizim aracı (5 sn sonra kaybolan; Loom tarzı).
- Hide system UI (Dock / menü çubuğu / masaüstü simgeleri).
- Stil presetleri + varsayılan preset.
- Embed (iframe; `autoplay`, `hide_title` gibi parametreler).
- Cursor: SVG yeniden çizim, hareketsizlikte auto-hide.
- Basit izlenme sayacı (sadece sahibe).

### Sonrası
- Sahneler (split screen, floating, camera-only geçişleri), geçişler (crossfade).
- Pencere/tarayıcı/MacBook çerçeveleri, notch overlay.
- Metin overlay'leri, klavye tuşu gösterimi, müzik track'i.
- Teleprompter / speaker notes.
- Screenshot modu (güzelleştirme + annotasyon).
- Konfeti ve benzeri eğlence efektleri.
- Altyazılar (yerel Apple Speech; transkripsiyon AI sayılırsa **kapsam dışı**), SRT/VTT.
- Cursor-only şeffaf MOV, HEVC export (Cap'te istek olarak bekliyor).
- İzleyici sayfasında yorum/reaksiyon, CTA butonu, ayrıntılı analitik (mevcut "izleyici sadece izler" kapsamının dışında, ileride değerlendirilebilir).
- Özel domain (self-host senaryosu).

### Kapsam dışı (hatırlatma)
- AI: otomatik başlık/özet/bölüm, transcript ile düzenleme, dolgu/sessizlik kaldırma, ajan entegrasyonları.
- Ekip: workspace, spaces, SSO/SCIM, admin analitiği, entegrasyonlar, uyumluluk sertifikaları.

### Kaçınılması gereken tuzaklar (şikayetlerden çıkarım)
- Bellek/CPU şişmesi ve editör oynatma takılması (Cap'in en çok şikayet alan konusu) → Metal tabanlı önizleme, proxy/düşük çözünürlüklü önizleme, AVFoundation composition.
- Yükleme başarısızlıkları ve ses senkronu (Loom'un en çok şikayet alan konusu) → yeniden denenebilir, devam ettirilebilir (resumable) yükleme; tüm track'ler için tek saat kaynağı (CMClock / SCK sample timestamps).
- Varsayılan hotkey olmaması (Cap) ve sadece QWERTY desteği (Loom) → layout bağımsız kısayollar.

---

## Kaynaklar
- Cap ana sayfa: https://cap.so
- Cap fiyatlandırma: https://cap.so/pricing
- Cap changelog: https://cap.so/changelog
- Cap docs: https://cap.so/docs, https://cap.so/docs/recording/studio-mode, https://cap.so/docs/recording/instant-mode, https://cap.so/docs/recording/camera-and-mic, https://cap.so/docs/recording/keyboard-shortcuts, https://cap.so/docs/sharing/share-a-cap, https://cap.so/docs/sharing/embeds, https://cap.so/docs/sharing/comments, https://cap.so/docs/sharing/analytics
- Cap GitHub: https://github.com/CapSoftware/Cap (~23.6k yıldız; AGPLv3 + MIT crate'ler)
- Cap GitHub issues: https://github.com/CapSoftware/Cap/issues?q=is%3Aissue+sort%3Areactions-%2B1-desc
- Cap incelemesi (rakip firma): https://www.screensnap.pro/blog/cap-so-review
- Loom fiyatlandırma: https://www.loom.com/pricing
- Loom ekran kaydedici: https://www.loom.com/screen-recorder, https://www.loom.com/products/screen-recording-app
- Loom yardım: https://support.atlassian.com/loom/docs/get-started-with-loom-for-macos, https://support.atlassian.com/loom/docs/choose-your-recording-mode/, https://support.atlassian.com/loom/docs/use-looms-keyboard-shortcuts/, https://support.atlassian.com/loom/docs/pause-and-resume-while-recording/, https://support.atlassian.com/loom/docs/highlight-your-mouse-clicks/, https://support.atlassian.com/loom/docs/edit-your-loom-video/, https://support.atlassian.com/loom/docs/edit-your-video-settings-disable-comments-emoji-reactions-downloads-and-more/, https://support.atlassian.com/loom/docs/add-and-edit-a-call-to-action-button/, https://support.atlassian.com/loom/docs/use-looms-privacy-settings/, https://support.atlassian.com/loom/docs/protect-your-videos-with-a-password, https://support.atlassian.com/loom/docs/embed-your-video-into-a-webpage/, https://support.atlassian.com/loom/docs/how-long-can-i-record/
- Loom gelişmiş kayıt dersi: https://community-link.atlassian.com/learning/lesson/create-more-engaging-videos-with-advanced-recording-features-in-loom
- Loom incelemeleri: https://trainn.co/blog/loom-reviews/ (rakip blog), https://www.capterra.com/p/191187/Loom/
