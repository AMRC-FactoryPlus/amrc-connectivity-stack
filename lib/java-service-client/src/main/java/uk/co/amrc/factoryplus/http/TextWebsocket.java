/*
 * Factory+ Java service client
 * Jetty WebSocket endpoint class
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.http;

import org.eclipse.jetty.websocket.api.Callback;
import org.eclipse.jetty.websocket.api.Session;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.disposables.SerialDisposable;
import io.reactivex.rxjava3.subjects.*;

import uk.co.amrc.factoryplus.util.Duplex;

public class TextWebsocket 
    extends Duplex.Base<String, String>
{
    private Session.Listener ep;

    private TextWebsocket (Observer<String> send, Observable<String> recv,
        Session.Listener ep)
    {
        super(send, recv);
        this.ep = ep;
    }

    static TextWebsocket create ()
    {
        final var send = UnicastSubject.<String>create();
        final var recv = PublishSubject.<String>create();
        final var ep = new Endpoint(send, recv);

        return new TextWebsocket(send, recv, ep);
    }

    Session.Listener getEndpoint() { return ep; }

    public static class Endpoint implements Session.Listener.AutoDemanding
    {
        private Observable<String> send;
        private Observer<String> recv;
        private SerialDisposable sub;

        Endpoint (Observable<String> send, Observer<String> recv)
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
}
