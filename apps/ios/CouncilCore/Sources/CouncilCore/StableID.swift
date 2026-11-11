import Foundation
import CryptoKit
public enum StableID {
    /// Same SHA-256 UUID projection as the web client's daily-record contract.
    public static func forKey(_ key:String)->String {var bytes=Array(SHA256.hash(data:Data(key.utf8)).prefix(16));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;let hex=bytes.map {String(format:"%02x",$0)}.joined();let cuts=[8,12,16,20];var result="";for (i,char) in hex.enumerated() {if cuts.contains(i) {result+="-"};result.append(char)};return result}
}
