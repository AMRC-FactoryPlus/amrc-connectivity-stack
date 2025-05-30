import next from "./next.js";
export default function maybe(cb, promise) {
    if (cb) {
        promise.then(function (result) {
            next(function () {
                cb(null, result);
            });
        }, function (err) {
            next(function () {
                cb(err);
            });
        });
        return undefined;
    }
    else {
        return promise;
    }
}
