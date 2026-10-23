# Umi — Ürün stratejisi

## Kapsam
- **Kayıt:** ekran / pencere / alan, kamera balonu, mikrofon + sistem sesi, duraklat/devam
- **Kayıt sırasında:** çizim, imleç vurgusu, tıklama efekti, geri sayım, kısayollar
- **Düzenleme:** kırpma, kesme, birleştirme, kapak görseli
- **Paylaşım:** dosya dışa aktarma (MP4/GIF) + link paylaşımı
- **İzleyici:** sadece web oynatıcı (yorum/analitik yok)
- **Kapsam dışı:** AI özellikleri, ekip/workspace

## İş modeli
- cap.so/pricing gibi 3 katmanlı model. Katman içerikleri ve fiyatlar **henüz kararlaştırılmadı**.
- Cap'ten farkımız: **sınırsız yerel kayıt & düzenleme ücretsiz**, **ticari kullanım tüm katmanlarda serbest**.
- **Bulut paylaşımı yalnızca ücretli** (ücretsiz/limitli bulut katmanı yok).
- Kural: yerel özellikler asla hesap veya ödeme istemez.

## Teknik kararlar
- Minimum macOS 15
- Dağıtım: hem notarize DMG (+ Sparkle) hem Mac App Store
- Bulut depolama adayı: Cloudflare R2 (egress ücretsiz)
- Alan adı: umi.cam · Bundle ID: `cam.umi.app`
