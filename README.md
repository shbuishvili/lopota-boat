# Lopota Boat Race (Multiplayer)

მინი თამაში — Lopota Lake Resort & Spa-ის თემატიკით ნავების შეჯიბრი დეპარტამენტების მიხედვით.

## Multiplayer წესები

- ოთახში (room) **Start** აქტიურდება მხოლოდ როცა მოთამაშეები **≥ 3** (ანუ 2-ზე მეტი)
- ყველა ერთ ლინკზე შედის: `...?room=ABC123`

## Local გაშვება (სურვილისამებრ)

Node უნდა გქონდეს.

```bash
npm install
npm start
```

შემდეგ გახსენი: `http://localhost:3000/?room=TEST01`

## Render deploy (რეკომენდებული)

1) Push გააკეთე GitHub repo-ში, რომ `lopota-boat-race/` შეიცავდეს:
   - `index.html`, `style.css`, `game.js`
   - `assets/lopota-logo.svg`
   - `server.js`, `package.json`

2) Render-ში:
   - New → **Web Service** → Connect repo
   - **Root Directory**: `lopota-boat-race`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

3) Deploy-ის მერე მიიღებ public URL-ს. ოთახის ლინკი იქნება:

`https://<your-render-app>.onrender.com/?room=ABC123`

გაუზიარე ეს ლინკი მეგობრებს/თანამშრომლებს — როცა 3+ ადამიანი შევა, Start გახდება ხელმისაწვდომი.

## ლოგო

- ნაგულისხმევად გამოიყენება placeholder ლოგო: `assets/lopota-logo.svg`
- შეგიძლია ატვირთო საკუთარი ლოგო UI-დან (ბრაუზერში დაიმახსოვრებს localStorage-ით)

