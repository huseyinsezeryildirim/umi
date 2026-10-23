# Umi — Yol haritası

Hedef: **Loom'un hızı + Cap Studio'nun cilası**, native ve ücretsiz. Ayrıntılı rakip analizi: [RESEARCH-cap-loom.md](RESEARCH-cap-loom.md).

## M1 — Katmanlı kayıt motoru
- [x] Her kayıt bir proje paketi (`.umi`): `screen.mov`, `camera.mov`, `cursor.json`, `project.json`
- [x] Ekran imleçsiz ve kamera balonu olmadan kaydedilir; imleç ve tıklamalar zaman damgalı veri olarak tutulur
- [x] Tüm track'ler tek saat kaynağı (host clock) ile senkron; pause tüm track'leri birlikte kaydırır
- [x] Mikrofon ve sistem sesi ayrı ses track'leri
- [x] Çökmeye dayanıklı yazım (fragmented MOV)
- [ ] Alan (bölge) seçimi, yalnız kamera modu
- [ ] Varsayılan global kısayollar (başlat/durdur, duraklat, iptal)
- [x] Restart

## M2 — Studio editörü (Cap seviyesi)
- [x] Tek render motoru (Core Image/Metal): önizleme ve dışa aktarma aynı kodla
- [x] Arka plan (renk, gradient, görsel), padding, köşe yuvarlaklığı, gölge
- [x] İmleç: yumuşatma (spring), boyut, gizleme, tıklama halkası
- [x] Kamera: konum (köşe presetleri), boyut, şekil (daire/squircle/kare), gizleme — sürükleyerek konumlandırma eksik
- [x] Otomatik zoom (tıklamalardan) + manuel zoom segmentleri
- [x] Trim, split, segment silme, undo/redo (yıkıcı olmayan proje dosyası)
- [x] MP4 dışa aktarma: 720p/1080p/4K, 30/60 fps, kalite presetleri

## M3 — Paylaşım ve izleyici sayfası (ücretli bulut)
- [ ] Durdur → yükle → link panoda; yeniden denenebilir/devam ettirilebilir yükleme
- [ ] İzleyici sayfası: hesapsız izleme, hız, tam ekran, `t=` zaman linki, OG önizleme
- [ ] İndirme izni, link iptali, şifre, **link süresi (expiry)**
- [ ] Cloudflare R2 + Workers backend

## M4 — Loom'un kayıt anı özellikleri ve cila
- [ ] Kamera balonu: daire/squircle, 3–5 boyut, köşeye yapışma, konum hafızası, ayna, arka plan bulanıklığı
- [ ] Kayıt sırasında çizim (birkaç saniye sonra kaybolan), tıklama halkası canlı
- [ ] Dock/menü çubuğu/masaüstü simgelerini gizleme
- [ ] GIF dışa aktarma, hız segmentleri, en-boy oranları, blur/pixelate maskeleri
- [ ] Klip birleştirme / MP4 içe aktarma, stil presetleri
- [ ] Instant mode: kayıt sürerken yükleme
- [ ] Kendi depolama alanını bağlama (S3/R2), embed

## Sonrası
Sahneler (split, kamera-only geçişleri), cihaz çerçeveleri, metin overlay, tuş gösterimi, teleprompter, konfeti, screenshot modu.

## Kapsam dışı
AI (özet, transkript düzenleme, dolgu kelime silme), ekip/workspace.
