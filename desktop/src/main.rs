mod api;
mod app;
mod models;
mod ui;

fn main() -> eframe::Result<()> {
    // tokio runtime живёт всё время работы приложения; eframe крутит свой цикл
    // в главном потоке, а сетевые задачи уходят в runtime через Handle::spawn.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to start tokio runtime");
    let handle = rt.handle().clone();
    let _guard = rt.enter();

    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default().with_inner_size([520.0, 220.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Roblox Player Sniper",
        options,
        Box::new(move |_cc| Ok(Box::new(app::App::new(handle)))),
    )
}
