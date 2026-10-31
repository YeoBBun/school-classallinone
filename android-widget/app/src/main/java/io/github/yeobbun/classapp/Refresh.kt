package io.github.yeobbun.classapp

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.TimeUnit

object Refresh {
    private const val PERIODIC = "pending-periodic"
    private const val NOW = "pending-now"

    /**
     * 구글 드라이브에서 받아 저장한다. 실패해도 전에 받은 목록은 그대로 두고 오류만 남긴다.
     * 돌려주는 값: 오류 문장 (성공이면 null). 메인 스레드에서 부르면 안 된다.
     */
    fun run(ctx: Context): String? {
        val p = Prefs(ctx)
        if (!p.configured) return "학급관리 앱에서 구글 로그인을 해 주세요."
        val err = try {
            val token = GoogleAuth.silentToken(ctx, p.googleEmail.ifBlank { null })
                ?: throw WidgetError("구글 로그인이 필요해요. 학급관리 앱을 열어 주세요.")
            Drive.fetchPending(token, p.sha)?.let { file ->
                val plain = Pending.decrypt(file.text, p.passphrase)
                Pending.parse(plain) // 형식 확인
                p.summaryJson = plain
                p.sha = file.version
            }
            p.checkedAt = System.currentTimeMillis()
            null
        } catch (e: WidgetError) {
            e.message
        } catch (e: IOException) {
            "인터넷에 연결되지 않았어요."
        } catch (e: Exception) {
            "불러오지 못했어요: ${e.message}"
        }
        p.error = err
        return err
    }

    /** 1시간마다 (인터넷 될 때) */
    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<Worker>(1, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun now(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<Worker>().build())
    }

    /** 몇 초 뒤에 한 번 (학급관리 앱이 요약을 올릴 시간을 두고) */
    fun later(ctx: Context, seconds: Long) {
        val req = OneTimeWorkRequestBuilder<Worker>().setInitialDelay(seconds, TimeUnit.SECONDS).build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
    }

    fun cancel(ctx: Context) {
        WorkManager.getInstance(ctx).cancelUniqueWork(PERIODIC)
    }

    class Worker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
        override suspend fun doWork(): Result {
            withContext(Dispatchers.IO) { run(applicationContext) }
            PendingWidget.updateAll(applicationContext)
            return Result.success()
        }
    }
}
