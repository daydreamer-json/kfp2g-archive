use aes_gcm::{ aead::{Aead, KeyInit}, Aes256Gcm, Nonce };
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
use serde_json::Value;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use windows_dpapi::{decrypt_data, Scope};

fn main() {
    if let Err(e) = run() {
        let error_json = json!({
            "error": format!("{:#}", e),
            "success": false
        });
        println!("{}", error_json);
        // std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let app_data = std::env::var("APPDATA").context("APPDATA environment variable not found")?;
    let dgp_path = PathBuf::from(app_data).join("dmmgameplayer5");

    let master_key_path = dgp_path.join("Local State");
    if !master_key_path.exists() {
        return Err(anyhow!("Local State file not found at: {:?}", master_key_path));
    }

    let master_key = get_aes_master_key(&master_key_path)?;
    let master_key_hex = hex::encode(&master_key);

    let enc_file_path = dgp_path.join("authAccessTokenData.enc");
    if !enc_file_path.exists() {
        return Err(anyhow!("Token file not found at: {:?}", enc_file_path));
    }

    let encrypted_data = fs::read(&enc_file_path)?;
    let raw_data_base64 = general_purpose::STANDARD.encode(&encrypted_data);

    let decrypted_json = decrypt_token_data(&encrypted_data, &master_key)?;

    let v: Value = serde_json::from_str(&decrypted_json)?;
    let access_token = v.get("accessToken")
        .and_then(|t| t.as_str())
        .unwrap_or("N/A");

    let output_json = json!({
        "masterKey": master_key_hex,
        "accessToken": access_token,
        "data": {
          "raw": raw_data_base64,
          "decrypted": decrypted_json
        },
        "success": true
    });
    println!("{}", serde_json::to_string_pretty(&output_json)?);

    Ok(())
}

fn get_aes_master_key(path: &PathBuf) -> Result<Vec<u8>> {
    let content = fs::read_to_string(path).context("Failed to read Local State file")?;
    let json: Value = serde_json::from_str(&content)?;
    let encrypted_key_b64 = json["os_crypt"]["encrypted_key"]
        .as_str()
        .context("Could not find encrypted_key in JSON")?;
    let encrypted_key_raw = general_purpose::STANDARD.decode(encrypted_key_b64)?;
    
    // prefix "DPAPI" (5 bytes) check
    if encrypted_key_raw.len() < 5 {
        return Err(anyhow!("Encrypted key is too short"));
    }

    let decrypted_key = decrypt_data(&encrypted_key_raw[5..], Scope::User, None)
        .map_err(|e| anyhow!("DPAPI decryption failed: {:?}", e))?;
    Ok(decrypted_key)
}

fn decrypt_token_data(data: &[u8], key: &[u8]) -> Result<String> {
    // "v10"(3 bytes) + nonce(12 bytes) + ciphertext(n bytes) + tag(16 bytes)
    if data.len() < 3 + 12 + 16 {
        return Err(anyhow!("Encrypted data is too short"));
    }
    
    let _v10 = &data[0..3];
    let nonce_slice = &data[3..15];
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| anyhow!("Invalid key length for AES-GCM"))?;
    let nonce = Nonce::from_slice(nonce_slice);

    let ciphertext_with_tag = &data[15..]; 

    let decrypted_bytes = cipher
        .decrypt(nonce, ciphertext_with_tag)
        .map_err(|e| anyhow!("AES-GCM decryption failed: {:?}", e))?;

    String::from_utf8(decrypted_bytes).context("Decrypted data is not valid UTF-8")
}
