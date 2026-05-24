//! macOS Keychain wrapper for the `mashi_api_token`.
//!
//! Per AGENTS.md "OAuth provider conventions" — every secret on this
//! repo lives encrypted at rest. The browser extension persists the
//! token in `chrome.storage.local` (which is sandboxed but plaintext on
//! disk); on macOS we can do better via the system keychain. This
//! module uses the `security-framework` crate to store the token under
//! `service = "app.mashi.helper"`, `account = "mashi_api_token"`.
//!
//! All token reads/writes flow through here. Settings.json never sees
//! the plaintext token.

use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

const SERVICE: &str = "app.mashi.helper";
const ACCOUNT: &str = "mashi_api_token";

#[derive(Debug, thiserror::Error)]
pub enum KeychainError {
    #[error("keychain: {0}")]
    System(String),
}

pub fn store_token(token: &str) -> Result<(), KeychainError> {
    set_generic_password(SERVICE, ACCOUNT, token.as_bytes())
        .map_err(|e| KeychainError::System(e.to_string()))
}

pub fn read_token() -> Result<Option<String>, KeychainError> {
    match get_generic_password(SERVICE, ACCOUNT) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) => {
            // `errSecItemNotFound` = -25300 means "no such item"; treat as None.
            let msg = e.to_string();
            if msg.contains("-25300") || msg.to_lowercase().contains("not found") {
                Ok(None)
            } else {
                Err(KeychainError::System(msg))
            }
        }
    }
}

pub fn clear_token() -> Result<(), KeychainError> {
    match delete_generic_password(SERVICE, ACCOUNT) {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("-25300") || msg.to_lowercase().contains("not found") {
                Ok(())
            } else {
                Err(KeychainError::System(msg))
            }
        }
    }
}
