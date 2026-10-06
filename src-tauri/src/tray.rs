use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, include_image};

fn prefers_chinese(locales: &[String]) -> bool {
    locales.iter().any(|tag| {
        tag.split(['-', '_'])
            .next()
            .is_some_and(|primary| primary.eq_ignore_ascii_case("zh"))
    })
}

fn tray_labels(locales: &[String]) -> (&'static str, &'static str) {
    if prefers_chinese(locales) {
        ("显示", "退出")
    } else {
        ("Show", "Quit")
    }
}

fn tray_tooltip(locales: &[String]) -> &'static str {
    if prefers_chinese(locales) {
        "经营账本"
    } else {
        "BeanDesk"
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
        .tooltip(tray_tooltip(locales))
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
    use super::{tray_labels, tray_tooltip};

    #[test]
    fn tray_menu_follows_the_os_language() {
        assert_eq!(tray_labels(&["zh-CN".into()]), ("显示", "退出"));
        assert_eq!(tray_labels(&["en-US".into()]), ("Show", "Quit"));
        assert_eq!(tray_labels(&[]), ("Show", "Quit"));
    }

    #[test]
    fn tray_tooltip_uses_the_localized_product_name() {
        assert_eq!(tray_tooltip(&["zh-CN".into()]), "经营账本");
        assert_eq!(tray_tooltip(&["zh-Hans".into()]), "经营账本");
        assert_eq!(tray_tooltip(&["zh_CN".into()]), "经营账本");
        assert_eq!(tray_tooltip(&["en-US".into()]), "BeanDesk");
        assert_eq!(tray_tooltip(&[]), "BeanDesk");
    }
}
