<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use Illuminate\Support\Facades\Broadcast;

/*
|--------------------------------------------------------------------------
| Broadcast Channels
|--------------------------------------------------------------------------
|
| Here you may register all of the event broadcasting channels that your
| application supports. The given channel authorization callbacks are
| used to check if an authenticated user can listen to the channel.
|
*/

// User Channel
Broadcast::channel('events.user.{username}', function ($user, $username) {
    // Only the user who the events are addressed to should be able to listen to this channel
    return $user->username === $username;
});

// Flight Channel
Broadcast::channel('events.flight.{slug}', function ($user, $slug) {
    // All signed in users should be able to listen to this channel
    return auth()->check();
});
