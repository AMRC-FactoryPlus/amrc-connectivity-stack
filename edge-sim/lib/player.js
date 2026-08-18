/*
 * ACS simulator driver
 * Cassette player: transport control and the virtual clock.
 * Copyright 2026 University of Sheffield AMRC
 *
 * The clock model (settled 2026-08-18): a playback is fully described
 * by (start_time, rate), both parameters of Play. Every sample is
 * stamped start_time + offset; stamps never depend on rate, which only
 * paces wall-time emission. Pause is rate 0, seek is a position jump,
 * a mid-play rate change alters pacing but not stamps. Deterministic:
 * the same cassette and start time always produce identical stamps.
 */

export const MAX_RATE = 100;
export const TICK_MS = 100;

export const Status = Object.freeze({
    EMPTY:      "EMPTY",        /* no cassette loaded */
    LOADED:     "LOADED",       /* loaded, at position, not playing */
    PLAYING:    "PLAYING",
    PAUSED:     "PAUSED",
    ENDED:      "ENDED",        /* ran off the end of the cassette */
});

export class Player {
    constructor (opts) {
        /* emit(channel, value, stamp_ms) is called for each sample as
         * it falls due. onState(state) is called on any state change.
         * now() and timers are injectable for the tests. */
        this.emit = opts.emit;
        this.onState = opts.onState ?? (() => {});
        this.now = opts.now ?? (() => Date.now());
        this.setTimer = opts.setTimer
            ?? ((fn, ms) => setInterval(fn, ms));
        this.clearTimer = opts.clearTimer
            ?? (t => clearInterval(t));
        this.log = opts.log ?? (() => {});

        this.cassette = null;
        this.#reset();
    }

    #reset () {
        this.status = this.cassette ? Status.LOADED : Status.EMPTY;
        this.position = 0;      /* ms into the cassette timeline */
        this.cursor = 0;        /* index of next sample to emit */
        this.rate = 1;
        this.startTime = null;  /* stamp anchor, ms epoch */
        this.#stopTimer();
    }

    #stopTimer () {
        if (this.timer) {
            this.clearTimer(this.timer);
            this.timer = null;
        }
    }

    state () {
        return {
            status:     this.status,
            cassette:   this.cassette?.cassette?.uuid
                ?? this.cassette?.cassette?.name ?? null,
            position:   Math.round(this.position),
            rate:       this.status == Status.PLAYING ? this.rate : 0,
            start_time: this.startTime,
        };
    }

    #changed () {
        this.onState(this.state());
    }

    load (cassette) {
        this.#stopTimer();
        this.cassette = cassette;
        this.#reset();
        this.#changed();
    }

    eject () {
        this.#stopTimer();
        this.cassette = null;
        this.#reset();
        this.#changed();
    }

    #require (st, cmd) {
        if (!this.cassette)
            throw new Error(`${cmd}: no cassette loaded`);
    }

    /* Play. start_time (ms epoch) is optional and defaults to the
     * current time on a fresh start; resuming from pause keeps the
     * original anchor unless a new one is given. rate is optional and
     * keeps its current value. */
    play (opts = {}) {
        this.#require(null, "play");

        if (opts.rate != null)
            this.#checkRate(opts.rate);

        if (this.status == Status.PAUSED) {
            if (opts.start_time != null)
                this.startTime = opts.start_time;
        }
        else {
            if (this.status == Status.ENDED)
                this.position = this.cursor = 0;
            this.startTime = opts.start_time ?? this.now();
        }
        if (opts.rate != null)
            this.rate = opts.rate;

        this.status = Status.PLAYING;
        this.#anchor();
        this.timer ??= this.setTimer(() => this.tick(), TICK_MS);
        this.#changed();
    }

    pause () {
        this.#require(null, "pause");
        if (this.status != Status.PLAYING) return;
        this.tick();
        this.#stopTimer();
        this.status = Status.PAUSED;
        this.#changed();
    }

    stop () {
        this.#require(null, "stop");
        this.#stopTimer();
        this.status = Status.LOADED;
        this.position = 0;
        this.cursor = 0;
        this.#changed();
    }

    /* Jump the playback position. Stamps are always start_time +
     * offset, so seeking backwards re-emits earlier offsets with their
     * original (earlier) stamps. */
    seek (position) {
        this.#require(null, "seek");
        if (!Number.isFinite(position) || position < 0)
            throw new Error(`seek: bad position ${position}`);
        this.position = position;
        this.cursor = this.cassette.samples
            .findIndex(([off]) => off >= position);
        if (this.cursor < 0)
            this.cursor = this.cassette.samples.length;
        if (this.status == Status.ENDED && position < this.duration())
            this.status = Status.PAUSED;
        this.#anchor();
        this.#changed();
    }

    #checkRate (rate) {
        if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE)
            throw new Error(`Bad rate ${rate} (0 to ${MAX_RATE})`);
    }

    /* Change pacing mid-play. Rate 0 pauses. Stamps are unaffected. */
    setRate (rate) {
        this.#require(null, "rate");
        this.#checkRate(rate);
        if (rate == 0) return this.pause();
        if (this.status == Status.PLAYING) this.tick();
        this.rate = rate;
        this.#anchor();
        if (this.status == Status.PAUSED) {
            this.status = Status.PLAYING;
            this.timer ??= this.setTimer(() => this.tick(), TICK_MS);
        }
        this.#changed();
    }

    duration () {
        return this.cassette?.cassette?.duration_ms ?? 0;
    }

    #anchor () {
        this.wallRef = this.now();
        this.posRef = this.position;
    }

    /* Advance the virtual position and emit everything newly due. */
    tick () {
        if (this.status != Status.PLAYING) return;

        const wall = this.now();
        this.position = Math.min(
            this.posRef + this.rate * (wall - this.wallRef),
            this.duration());

        const { samples } = this.cassette;
        while (this.cursor < samples.length
                && samples[this.cursor][0] <= this.position) {
            const [off, ch, value] = samples[this.cursor++];
            const path = this.cassette.byId.get(ch).path;
            this.emit(path, value, this.startTime + off);
        }

        if (this.position >= this.duration()) {
            this.#stopTimer();
            this.status = Status.ENDED;
            this.#changed();
        }
    }
}
