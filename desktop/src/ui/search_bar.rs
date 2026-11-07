use eframe::egui;

/// Поля «игра» и «username» + кнопка Search.
/// Возвращает `true`, если нажата Search или Enter в одном из полей.
pub fn show(ui: &mut egui::Ui, place: &mut String, username: &mut String) -> bool {
    let mut submit = false;

    ui.horizontal(|ui| {
        ui.label("Game:");
        let r = ui.add(
            egui::TextEdit::singleline(place)
                .hint_text("Place ID or roblox.com/games/... link")
                .desired_width(280.0),
        );
        submit |= r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
    });

    ui.horizontal(|ui| {
        ui.label("Player:");
        let r = ui.add(
            egui::TextEdit::singleline(username)
                .hint_text("Roblox username")
                .char_limit(20)
                .desired_width(180.0),
        );
        submit |= r.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
        if ui.button("Search").clicked() {
            submit = true;
        }
    });

    submit
}
