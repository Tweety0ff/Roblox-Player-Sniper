# Roblox Player Sniper — Desktop (Rust + egui)

Desktop port of the browser extension in the repository root. Work in progress.

## Status

Step 1: window, Place ID / username fields, one request to
`games.roblox.com/v1/games/{place}/servers/Public?limit=100&cursor=`, result printed to the console.

## Run

```
cd desktop
cargo run
```

Windows, stable Rust. Only Roblox's public endpoints are used: no cookies, no login.
