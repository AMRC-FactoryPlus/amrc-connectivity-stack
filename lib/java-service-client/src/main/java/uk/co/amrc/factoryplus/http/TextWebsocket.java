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
import io.reactivex.rxjava3.observers.*;

import uk.co.amrc.factoryplus.util.Duplex;

public class TextWebsocket 
    extends Duplex.Base<String, String>
{
    public TextWebsocket (Observer<String> send, Observable<String> recv)
    {
        super(send, recv);
    }

    public static class Endpoint implements Session.Listener.AutoDemanding
    {
        private Subject<String> send;
        private ObservableEmitter<String> recv;
        private TextWebsocket duplex;
        private SerialDisposable sub;

        public Endpoint ()
        {
            this.send = UnicastSubject.<String>create();
            this.sub = new SerialDisposable();

            /* It seems silly to create a cold Observable just in order
             * to convert it to a hot Observable, but RxJava doesn't
             * have the fromEvent* constructors. */
            final var cobs = Observable.<String>create(
                    em -> this.recv = em.serialize())
                .publish();
            cobs.connect();

            this.duplex = new TextWebsocket(send, cobs);
        }

        public TextWebsocket getDuplex () { return duplex; }

        public void onWebSocketOpen (Session sess) {
            sess.addIdleTimeoutListener(e -> false);
            sub.set(send
                .concatMapCompletable(msg -> {
                    var cf = new Callback.Completable();
                    sess.sendText(msg, cf);
                    return Completable.fromCompletionStage(cf);
                })
                .doFinally(() -> sess.close())
                .subscribe(() -> {}, e -> recv.tryOnError(e)));

        }

        public void onWebSocketClose (int sc, String r, Callback done) {
            sub.dispose();
            recv.onComplete();
        }

        public void onWebSocketError (Throwable e) {
            recv.tryOnError(e);
        }

        public void onWebSocketText (String msg) {
            recv.onNext(msg);
        }
    }
}
