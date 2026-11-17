# Adres Bulucu: devir notu (2026-11-17)

Müşterinin tarif ettiği (sokak, site, cami, ilçe...) adresi bulmaya yarayan, herkese açık küçük bir web uygulaması.
Kod: https://github.com/muzafferseyranli1/adres (dal: `main`)
Canlı: http://vvkt33h2pmm1ehaszjan4onw.188.132.198.144.sslip.io/ (geçici adres, http)

## Yapı
- `server.js`: bağımlılıksız Node sunucusu. `public/` klasörünü sunar; API anahtarlarını tarayıcıdan gizleyen vekil uçlar sağlar:
  - `/api/apt/*` → apiturkiye.com (il, ilçe, mahalle, sokak, kapı no, autocomplete)
  - `/api/yandex/search` → Yandex Geocoder
  - `/api/google/search` → Google Places (New) Text Search
  - `/api/apt-index` → il+ilçe dizini (ilçe adından ili bulmak için; ilk açılışta ~82 istekle kurulur, `/data/district-index.json` içinde 7 gün saklanır)
  - `/api/config` → hangi kaynakların anahtarı tanımlı
- `public/index.html`: tek sayfa arayüz (Leaflet + OSM haritası). Üç sütun: arama, seçilen adres, harita.
  Arama iki listede çıkar: "Resmi adres kayıtları" (apiturkiye) ve "Yer/site/cami/işyeri" (Google + Yandex + Photon + Nominatim).
  Yer seçilince mahalle/ilçe/il apiturkiye kayıtlarıyla eşleştirilir, 300 m çevredeki sokaklar (Photon) listelenir.
- Koruma: IP başına dakikada 40 istek; servis başına günlük tavan (apiturkiye 950, Yandex 900, Google 160); önbellek. Sayaçlar `/data/usage.json` içinde (Coolify kalıcı volume).

## Ortam değişkenleri (değerleri repoda YOK; Coolify > adres > Environment Variables)
`APITURKIYE_KEY`, `YANDEX_GEOCODER_KEY`, `GOOGLE_PLACES_KEY`. İsteğe bağlı: `APT_DAILY_MAX`, `YANDEX_DAILY_MAX`, `GOOGLE_DAILY_MAX`, `RATE_PER_MIN`.
Üçü de şu an tanımlı ve çalışıyor. Yerelde `.env.example` dosyasını `.env` olarak kopyalayıp anahtarları yazın (`.env` git'e girmez).

## Yayın (Coolify)
- Panel: https://panel.derinsoft.com.tr → proje `adres` → uygulama (Dockerfile ile derlenir, port 3000, `/data` kalıcı volume).
- Otomatik yayın YOK: GitHub uygulaması yalnızca RMSv3 deposunu görüyor, `adres` "public repository" olarak bağlı. Kodu `git push` ettikten sonra Coolify'da **Redeploy** basın (~1,5 dk).
- Son yayınlanan commit: bu notun hemen öncesindeki "Sokagi yazimi duzeltmesi" (`28cb401`).

## Yerelde çalıştırma
- Node 18+ gerekir. Bu bilgisayarda winget ile kuruldu (`OpenJS.NodeJS.LTS`); diğer bilgisayarda `winget install OpenJS.NodeJS.LTS`.
- `node server.js` veya `baslat.bat` → http://localhost:3900

## Doğrulananlar
- apiturkiye: il listesi, autocomplete (yazım hatasına toleranslı), sokak → kapı numaraları, ilçeden il bulma ("bağdat cadesi kadıköy" → İstanbul/Kadıköy).
- Google: site/apartman/cami/market aramaları sonuç veriyor ("yıldız sitesi çankaya" vb.).
- Yandex Geocoder: sokak/cadde aramalarında sonuç veriyor.
- Harita/mahalle eşleştirme: "Yıldız Sitesi" → Çukurambar Mah., Çankaya/Ankara (resmi kayıtla).

## Bilinen eksikler / yapılacaklar
1. **Yandex şartları:** ücretsiz lisans herkese açık proje ister, veri saklamayı yasaklar (biz saklamıyoruz). Sonuçların Yandex haritasında gösterilmesi gerekip gerekmediğini koşullardan doğrulamadım; biz OSM haritası kullanıyoruz. Riskli görürseniz Yandex'i kapatın (anahtarı silmek yeterli).
2. **Alan adı + https:** geçici sslip.io adresi var. Kendi alan adını Coolify > Domains'e yazın.
3. **Otomatik yayın:** GitHub App'e `adres` deposu için de izin verilirse push → otomatik deploy yapılabilir.
4. **Google bütçe uyarısı** (Billing > Budgets & alerts) henüz kurulmadı. Sunucu tavanı (160/gün) var ama ikinci güvence iyi olur. Google anahtarı sohbette ekran görüntüsünde kısmen göründü; isterseniz yenisini üretin.
5. **apiturkiye Core limiti** günde 1.000 istek. Yoğun kullanımda sayaçlara bakın; gerekirse Pro (500 TL/ay, 200.000 istek). Bulk Snapshot yalnızca Ultra pakette (5.000 TL/ay), şimdilik gerekmez.
6. **Resmi adreslerde koordinat yok:** apiturkiye'den seçilen sokak haritada işaretlenemiyor.
7. **WhatsApp konum → adres (sonraki aşama):** WAHA'nın `message` webhook'unda gelen `location` (enlem/boylam) için bu uygulamaya `/api/reverse?lat=&lon=` ucu eklenecek (Yandex ters geocode + apiturkiye eşleştirme), anahtar korumalı; MyWA bunu çağıracak. Konum kişisel veri: herkese açık sayfaya yazılmamalı. WAHA için kişisel telefon yerine şirket adına ayrı hat önerildi (WAHA'nın resmi olmayan modları numaranın kapanmasına yol açabilir; uzun vadede WhatsApp Cloud API). MyWA kodu bu bilgisayarda bulunamadı; konumu/GitHub deposunu bilen kişiden alınmalı.
8. İsteğe bağlı: Yandex Geosuggest (günde 1.000 ücretsiz) ve açık Türkiye POI veri seti (Zenodo, ~2,2 milyon yer) Google'ın günlük 160 sınırını hafifletmek için değerlendirilebilir; önce bir hafta kullanıp sayaçlara bakılması önerildi.
9. Kapı numarası kayıtlarının gerçek kullanımdaki doğruluğu denenmedi; operatörlerle denenmeli.
