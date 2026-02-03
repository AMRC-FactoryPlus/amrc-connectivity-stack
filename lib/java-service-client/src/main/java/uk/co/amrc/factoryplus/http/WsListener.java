/*
 * Factory+ Java service client
 * Jetty WebSocket endpoint class
 * Copyright 2026 University of Sheffield AMRC
 */

/* If this is created as an anon class we get an
 * IllegalAccessException when Jetty tries to use it. I don't
 * understand why.
 */

package uk.co.amrc.factoryplus.http;

import org.eclipse.jetty.websocket.api.Callback;
import org.eclipse.jetty.websocket.api.Session;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.disposables.SerialDisposable;

public class WsListener implements Session.Listener.AutoDemanding
{
    Observable<String> send;
    Observer<String> recv;
    SerialDisposable sub;

    WsListener (Observable<String> send, Observer<String> recv)
    {
        this.send = send;
        this.recv = recv;
        this.sub = new SerialDisposable();
    }

    public void onWebSocketOpen (Session sess) {
        sess.addIdleTimeoutListener(e -> false);
        sub.set(send
            .concatMapCompletable(msg -> {
                var cf = new Callback.Completable();
                sess.sendText(msg, cf);
                return Completable.fromCompletionStage(cf);
            })
            .doFinally(() -> sess.close())
            .subscribe(() -> {}, e -> recv.onError(e)));

    }

    public void onWebSocketClose (int sc, String r, Callback done) {
        sub.dispose();
        recv.onComplete();
    }

    public void onWebSocketError (Throwable e) {
        recv.onError(e);
    }

    public void onWebSocketText (String msg) {
        recv.onNext(msg);
    }
}
