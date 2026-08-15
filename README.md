# Kortit ja perehdytykset

Puhelimelle ja tabletille suunniteltu PWA-sovellus työntekijöiden korttien ja perehdytysten voimassaolon seurantaan.

## Toiminnot

- henkilökohtainen PIN-kirjautuminen
- työntekijä näkee, lisää, muokkaa ja poistaa omia merkintöjään
- ylläpitäjä näkee ja muokkaa kaikkien merkintöjä
- kortin varoitus alkaa kaksi kuukautta ennen vanhenemista
- perehdytyksen varoitus alkaa kuukautta ennen vanhenemista
- tarkka päivä on valinnainen; ilman päivää voimassaolo päättyy kuukauden viimeisenä päivänä
- Google Sheets toimii keskitettynä tietovarastona

## Käyttöönotto

1. Luo uusi Google Sheet.
2. Avaa **Laajennukset → Apps Script**.
3. Kopioi `apps-script/Code.gs` Apps Scriptin `Code.gs`-tiedostoon.
4. Vaihda `CONFIG.initialUsers`-kohdan kaikki `VAIHDA_...`-arvot henkilökohtaisiksi 4–12-numeroisiksi PIN-koodeiksi. Jokaisella pitää olla eri PIN.
5. Suorita Apps Scriptissä kerran funktio `setupSystem` ja hyväksy oikeudet.
6. Valitse **Käyttöönotto → Uusi käyttöönotto → Verkkosovellus**. Suorita käyttäjänä: minä. Käyttöoikeus: kaikki.
7. Kopioi `/exec`-osoite ja lisää se `app.js`-tiedoston `API_URL`-vakioon.
8. Ota GitHub Pages käyttöön: **Settings → Pages → Deploy from a branch → main / root**.

PIN-koodeista tallennetaan Sheetiin vain suolatut SHA-256-tiivisteet. PIN kulkee HTTPS-yhteydellä Apps Scriptille tarkistamista varten ja säilyy selaimessa vain istunnon ajan.
