use crate::{
    api::roblox::{parse_place_id, RobloxClient},
    ui,
};
use eframe::egui;
use std::sync::mpsc::{channel, Receiver, Sender};
use tokio::runtime::Handle;

/// Сообщения из async-задач в UI-поток.
pub enum Msg {
    FirstPageLoaded(Result<String, String>),
}

pub struct App {
    rt: Handle,
    client: RobloxClient,
    place_input: String,
    username: String,
    status: String,
    busy: bool,
    tx: Sender<Msg>,
    rx: Receiver<Msg>,
}

impl App {
    pub fn new(rt: Handle) -> Self {
        let (tx, rx) = channel();
        Self {
            rt,
            client: RobloxClient::new(),
            place_input: String::new(),
            username: String::new(),
            status: "Enter a game and press Search".into(),
            busy: false,
            tx,
            rx,
        }
    }

    fn start_search(&mut self, ctx: &egui::Context) {
        let Some(place_id) = parse_place_id(&self.place_input) else {
            self.status = "Can't read a Place ID from that input".into();
            return;
        };

        self.busy = true;
        self.status = format!("Loading servers for place {place_id}...");

        let client = self.client.clone();
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        let username = self.username.clone();

        // Запрос идёт в tokio runtime, UI-поток не блокируется.
        self.rt.spawn(async move {
            let result = match client.fetch_servers_page(place_id, "").await {
                Ok(page) => {
                    println!("username (not used yet): {username:?}");
                    println!(
                        "place {place_id}: {} servers on first page, next cursor: {}",
                        page.data.len(),
                        page.next_page_cursor.is_some()
                    );
                    if let Some(s) = page.data.first() {
                        println!(
                            "first server: job_id={} playing={}/{} tokens={}",
                            s.id,
                            s.playing,
                            s.max_players,
                            s.player_tokens.len()
                        );
                    }
                    Ok(format!("OK: {} servers on first page", page.data.len()))
                }
                Err(e) => {
                    eprintln!("request failed: {e:#}");
                    Err(format!("{e:#}"))
                }
            };
            let _ = tx.send(Msg::FirstPageLoaded(result));
            ctx.request_repaint(); // разбудить UI, чтобы он забрал сообщение
        });
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        while let Ok(msg) = self.rx.try_recv() {
            match msg {
                Msg::FirstPageLoaded(Ok(text)) => self.status = text,
                Msg::FirstPageLoaded(Err(e)) => self.status = format!("Error: {e}"),
            }
            self.busy = false;
        }

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("Roblox Player Sniper");
            ui.add_space(8.0);

            ui.add_enabled_ui(!self.busy, |ui| {
                if ui::search_bar::show(ui, &mut self.place_input, &mut self.username) {
                    self.start_search(ctx);
                }
            });

            ui.add_space(8.0);
            ui.label(&self.status);
        });
    }
}
