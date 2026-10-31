package io.github.yeobbun.classapp

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * 구글 드라이브에서 처리 예정 요약(class-pending.json) 받기.
 * 학급관리 앱(웹)이 맞출 때마다 잠금 비밀번호로 잠가 '학급관리' 폴더에 올린다 (src/sync/cloud.ts 의 pushPendingDrive).
 */
object Drive {
    var api = "https://www.googleapis.com/drive/v3"
    const val FILE = "class-pending.json"

    class File(val version: String, val text: String)

    /** 바뀌지 않았으면(version 같음) null */
    fun fetchPending(token: String, knownVersion: String?): File? {
        val q = URLEncoder.encode("name='$FILE' and trashed=false", "UTF-8")
        val list = JSONObject(get("$api/files?q=$q&fields=files(id,version)&orderBy=modifiedTime%20desc&pageSize=1", token))
        val files = list.getJSONArray("files")
        if (files.length() == 0) {
            throw WidgetError("아직 처리 예정 요약이 없어요. 학급관리 앱에서 구글 로그인 후 잠금 비밀번호까지 정해 주세요.")
        }
        val f = files.getJSONObject(0)
        val version = f.getString("version")
        if (version == knownVersion) return null
        return File(version, get("$api/files/${f.getString("id")}?alt=media", token))
    }

    private fun get(url: String, token: String): String {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Authorization", "Bearer $token")
            useCaches = false
        }
        try {
            when (val code = conn.responseCode) {
                200 -> {}
                401 -> throw WidgetError("구글 연결이 끝났어요. 학급관리 앱을 한 번 열어 주세요.")
                403 -> throw WidgetError("구글 드라이브 권한이 없어요. 학급관리 앱에서 다시 로그인해 주세요.")
                else -> throw WidgetError("구글 드라이브 응답 오류 ($code)")
            }
            return conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
        } finally {
            conn.disconnect()
        }
    }
}
