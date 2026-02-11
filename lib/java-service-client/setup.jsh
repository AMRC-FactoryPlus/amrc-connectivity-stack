/* JSHell startup script */

import org.json.*;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.core.Observable;
import io.reactivex.rxjava3.core.Observer;
import io.reactivex.rxjava3.disposables.*;
import io.reactivex.rxjava3.observers.*;

import uk.co.amrc.factoryplus.client.*;
import uk.co.amrc.factoryplus.util.*;

void log (String s) { System.out.println(s); }

<T> DisposableObserver<T> logobs (String m)
{
    return new DisposableObserver<T>() {
        private void _log (String t, Object o) {
            log(t + " " + m + ": " + o.toString());
        }
        public void onNext (T v) { _log("NEXT", v); }
        public void onError (Throwable e) { _log("ERROR", e); }
        public void onComplete () { _log("COMPLETE", ""); }
    };
}

var fplus = new FPServiceClient();
fplus.start();

var notify = new FPNotifyV2(fplus, FPUuid.Service.ConfigDB);
