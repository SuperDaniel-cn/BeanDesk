use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, include_image};

fn tray_labels(locales: &[String]) -> (&'static str, &'static str) {
    if locales
        .iter()
        .any(|tag| tag.split('-').next() == Some("zh"))
    {
        ("显示", "退出")
    } else {
        ("Show", "Quit")
    }
}

pub(crate) fn install(
    app: &AppHandle,
    locales: &[String],
) -> Result<(), Box<dyn std::error::Error>> {
    let (show, quit) = tray_labels(locales);
    let show_item = MenuItem::with_id(app, "show", show, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
    TrayIconBuilder::with_id("beandesk")
        .icon(include_image!("icons/tray.png"))
        .tooltip("BeanDesk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => crate::show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::tray_labels;

    #[test]
    fn tray_menu_follows_the_os_language() {
        assert_eq!(tray_labels(&["zh-CN".into()]), ("显示", "退出"));
        assert_eq!(tray_labels(&["en-US".into()]), ("Show", "Quit"));
        assert_eq!(tray_labels(&[]), ("Show", "Quit"));
    }
}
