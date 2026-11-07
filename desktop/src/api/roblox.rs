use crate::models::server::ServersPage;
use anyhow::{bail, Result};

/// Клиент публичных эндпоинтов Roblox (без авторизации и cookie).
#[derive(Clone)]
pub struct RobloxClient {
    http: reqwest::Client,
}

impl RobloxClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent("roblox-player-sniper-desktop/0.1")
            .build()
            .expect("failed to build http client");
        Self { http }
    }

    /// Одна страница `servers/Public`, те же параметры, что в content.js:
    /// `?limit=100&cursor={cursor}` (cursor пустой на первой странице).
    pub async fn fetch_servers_page(&self, place_id: u64, cursor: &str) -> Result<ServersPage> {
        let url = format!("https://games.roblox.com/v1/games/{place_id}/servers/Public");
        let resp = self
            .http
            .get(&url)
            .query(&[("limit", "100"), ("cursor", cursor)])
            .send()
            .await?;

        // Бэкофф для 429 добавим на следующем шаге, сейчас просто сообщаем.
        if resp.status().as_u16() == 429 {
            bail!("rate limited by Roblox (HTTP 429)");
        }
        Ok(resp.error_for_status()?.json::<ServersPage>().await?)
    }
}

/// Принимает Place ID (`920587237`) или ссылку на игру
/// (`https://www.roblox.com/games/920587237/Name`, в том числе с языком в пути).
pub fn parse_place_id(input: &str) -> Option<u64> {
    let s = input.trim();
    if let Ok(id) = s.parse::<u64>() {
        return Some(id);
    }
    let rest = s.split("/games/").nth(1)?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::parse_place_id;

    #[test]
    fn parses_plain_id() {
        assert_eq!(parse_place_id(" 920587237 "), Some(920587237));
    }

    #[test]
    fn parses_urls() {
        assert_eq!(
            parse_place_id("https://www.roblox.com/games/920587237/Adopt-Me"),
            Some(920587237)
        );
        assert_eq!(
            parse_place_id("https://www.roblox.com/ru/games/123/x"),
            Some(123)
        );
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_place_id("hello"), None);
        assert_eq!(parse_place_id("https://www.roblox.com/users/1/profile"), None);
    }
}
