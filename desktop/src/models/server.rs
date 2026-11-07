use serde::Deserialize;

/// Ответ `GET games.roblox.com/v1/games/{place}/servers/Public`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServersPage {
    pub next_page_cursor: Option<String>,
    #[serde(default)]
    pub data: Vec<Server>,
}

/// Один публичный сервер. `id` — это Job ID.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    #[serde(default)]
    pub playing: u32,
    #[serde(default)]
    pub max_players: u32,
    /// Токены игроков (Roblox отдаёт их не для всех игроков сервера).
    #[serde(default)]
    pub player_tokens: Vec<String>,
}
