package pt.arlequin.vtsalges;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Concha nativa mínima: uma WebView a carregar assets/index.html, que faz todo o trabalho
 * (lê a API do Porto de Lisboa, o AROME do Open-Meteo e os avisos do IPMA e desenha tudo).
 * Sem dependências externas, para o APK se construir só com o SDK (aapt2 + javac + d8).
 */
public class MainActivity extends Activity {
    private static final String FUNDO = "#0b1320";
    private WebView web;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true); // a página vive em file:// e chama APIs https
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);
        web.setBackgroundColor(Color.parseColor(FUNDO));
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
                Uri uri = pedido.getUrl();
                if ("file".equals(uri.getScheme())) {
                    return false; // a própria página
                }
                startActivity(new Intent(Intent.ACTION_VIEW, uri)); // ligações externas abrem no browser
                return true;
            }

            @Override
            public void onPageFinished(WebView vista, String url) {
                aplicarTemaDoSistema();
            }
        });
        getWindow().setStatusBarColor(Color.parseColor(FUNDO));
        getWindow().setNavigationBarColor(Color.parseColor(FUNDO));
        setContentView(web);
        web.loadUrl("file:///android_asset/index.html");
    }

    /** Diz à página se o telemóvel está em modo escuro (a WebView antiga não passa o prefers-color-scheme). */
    private void aplicarTemaDoSistema() {
        int modo = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        String tema = (modo == Configuration.UI_MODE_NIGHT_YES) ? "dark" : "light";
        web.evaluateJavascript("if (window.definirTemaSistema) definirTemaSistema('" + tema + "');", null);
    }

    @Override
    public void onConfigurationChanged(Configuration nova) {
        super.onConfigurationChanged(nova);
        if (web != null) {
            aplicarTemaDoSistema();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.evaluateJavascript("if (window.atualizarSeVelho) atualizarSeVelho();", null);
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
