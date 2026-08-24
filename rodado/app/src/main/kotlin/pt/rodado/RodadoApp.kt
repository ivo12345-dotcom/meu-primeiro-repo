package pt.rodado

import android.app.Application
import pt.rodado.data.Repository
import pt.rodado.data.RodadoDatabase
import pt.rodado.data.SettingsStore
import pt.rodado.tesla.TeslaSync

/**
 * As dependencias da app vivem aqui.
 *
 * Sao meia duzia de objectos sem ciclo de vida proprio; uma biblioteca de
 * injeccao so acrescentaria configuracao e mais uma fonte de erros de compilacao.
 */
class RodadoApp : Application() {

    val settings: SettingsStore by lazy { SettingsStore(this) }

    val repository: Repository by lazy {
        Repository(RodadoDatabase.get(this).dao(), settings)
    }

    val teslaSync: TeslaSync by lazy { TeslaSync(repository, settings) }

    override fun onCreate() {
        super.onCreate()
        TeslaSync.schedule(this)
    }
}
