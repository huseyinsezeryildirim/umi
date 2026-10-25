# Umi — Yol haritası

Hedef: **Loom'un hızı + Cap Studio'nun cilası**, native ve ücretsiz. Ayrıntılı rakip analizi: [RESEARCH-cap-loom.md](RESEARCH-cap-loom.md).

## M1 — Katmanlı kayıt motoru
- [x] Her kayıt bir proje paketi (`.umi`): `screen.mov`, `camera.mov`, `cursor.json`, `project.json`
- [x] Ekran imleçsiz ve kamera balonu olmadan kaydedilir; imleç ve tıklamalar zaman damgalı veri olarak tutulur
- [x] Tüm track'ler tek saat kaynağı (host clock) ile senkron; pause tüm track'leri birlikte kaydırır
- [x] Mikrofon ve sistem sesi ayrı ses track'leri
- [x] Çökmeye dayanıklı yazım (fragmented MOV)
- [x] Alan (bölge) seçimi, yalnız kamera modu
- [x] Varsayılan global kısayollar (başlat/durdur, duraklat, iptal)
- [x] Restart

## M2 — Studio editörü (Cap seviyesi)
- [x] Tek render motoru (Core Image/Metal): önizleme ve dışa aktarma aynı kodla
- [x] Arka plan (renk, gradient, görsel), padding, köşe yuvarlaklığı, gölge
- [x] İmleç: yumuşatma (spring), boyut, gizleme, tıklama halkası
- [x] Kamera: konum (köşe presetleri), boyut, şekil (daire/squircle/kare), gizleme — sürükleyerek konumlandırma eksik
- [x] Otomatik zoom (tıklamalardan) + manuel zoom segmentleri
- [x] Trim, split, segment silme, undo/redo (yıkıcı olmayan proje dosyası)
- [x] MP4 dışa aktarma: 720p/1080p/4K, 30/60 fps, kalite presetleri

## M2.5 — Cap Studio özellikleri
- [x] Gizlilik maskeleri: blur, pixelate, highlight (önizlemede sürükle/boyutlandır)
- [x] Zoom: 1x–4.5x, imleci takip et veya sabit odak (önizlemede tıkla)
- [x] Canvas: gradyan (açı), renk, macOS duvar kağıtları, kendi görselin, gren; cihaz çerçeveleri (macOS, Windows, tarayıcı, MacBook)
- [x] Sahneler: camera only, hide camera, split screen, floating; animasyonlu geçişler
- [x] Renk: Cinematic, Noir, Vintage, Frost, Golden, Midnight, Vivid, Dreamy + exposure/contrast/saturation/vignette/grain
- [x] Hareketli yazı: title, lower third, kicker, big stat, quote, typewriter; fade/slide/pop/typewriter
- [x] 3D kamera hareketleri: glide, unfold, pull back (odak bulanıklığı)
- [x] Altyazı: cihazda transkripsiyon (Apple Speech), satır düzenleme, aktif kelime vurgusu, SRT/VTT
- [x] Klipler: hız (0.25–8x), sıralama, crossfade; müzik (döngü + fade out)
- [x] Hazır müzik kütüphanesi: 50 CC0 parça (FreePD arşivi, archive.org/details/freepd), seçilince indirilir ve önbelleğe alınır

## M2.6 — Cap ile eşitlik (2026-10-24)
- [x] Alan seçerek kayıt, yalnız kamera, kalite ayarları (çözünürlük/fps)
- [x] Instant / Studio modları (Instant: dışa aktar + panoya kopyala; link bulut gelince)
- [x] En-boy oranı, Crop, Presets, kenarlık, padding %40
- [x] Editör düzeni: araç çubukları, ortalanmış transport, timeline zoom, Add track, ses dalgası, sarı trim tutamakları
- [x] Media kanalı (B-roll fill / PiP, sürükle-bırak), aralık Cut
- [x] MOV / GIF dışa aktarma, logo (branding), imleç stili/motion blur/idle gizleme, bulanık ekran ve masaüstü duvar kağıdı arka planı
- [x] Screenshot modu (⌥⇧4): güzelleştir + ok/kutu/yazı/vurgu/blur, kopyala/kaydet/paylaş
- [x] Özelleştirilebilir kısayollar, çoklu yazı kanalı, squircle köşe
- [x] Hazır müzik kütüphanesi: 50 CC0 parça (FreePD arşivi, archive.org/details/freepd), seçilince indirilir ve önbelleğe alınır

## M3 — Paylaşım ve izleyici sayfası (ücretli bulut)
- [x] Durdur → yükle → link panoda; yeniden denenebilir/devam ettirilebilir yükleme
- [x] İzleyici sayfası: hesapsız izleme, hız, tam ekran, `t=` zaman linki, OG önizleme
- [x] İndirme izni, link iptali, şifre, **link süresi (expiry)**
- [x] Cloudflare R2 + Workers backend

## M4 — Loom'un kayıt anı özellikleri ve cila
- [x] Kamera balonu: daire/squircle, 3–5 boyut, köşeye yapışma, konum hafızası, ayna, arka plan bulanıklığı
- [x] Kayıt sırasında çizim (birkaç saniye sonra kaybolan, ⌥⇧D); tıklama halkası editörde
- [x] Masaüstü simgelerini gizleme (macOS); Dock/menü çubuğu için alan kaydı
- [x] GIF dışa aktarma, hız segmentleri, en-boy oranları, blur/pixelate maskeleri
- [x] Klip birleştirme / MP4 içe aktarma, stil presetleri
- [ ] Instant mode: kayıt sürerken yükleme (şimdilik durdurunca yükleniyor)
- [x] Kendi depolama alanını bağlama (sunucuda R2/S3 uç noktası), embed

## Sonrası
Sahneler (split, kamera-only geçişleri), cihaz çerçeveleri, metin overlay, tuş gösterimi, teleprompter, konfeti, screenshot modu.

## Kapsam dışı
Ekip/workspace (ücretli, hesap altyapısı gerekiyor). AI özellikleri (özet, transkript düzenleme, dolgu kelime silme) artık cihazda ve ücretsiz.
