<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Support;

use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\Request;

class RecentPages
{
    /**
     *    Stores the page in the users recently visited pages cache
     */
    public static function storePageInCache($pageName)
    {
        // Configuration Variables
        $num_to_store = 5; // If there are more than this many stored, delete the oldest one
        $minutes_to_store
          = 1440; // These cookies will automatically be forgotten after this number of minutes. 1440 is 24 hours.

        // Create an object with the data required to create the "Recently Viewed" widget
        $current_page['name'] = $pageName;
        $current_page['url'] = Request::url(); // The current URL

        // Get the existing cookie data from the user
        $recent = Cookie::get('recently_viewed_content');

        // Since cookies must be strings, the data is stored as JSON.
        // Decode the data.
        // The second parameter, "[w]hen TRUE, returned objects will be
        // converted into associative arrays."
        $recent = json_decode($recent, true);

        // If the URL already exists in the user's history, delete the older one
        // Note -- If there are multiple URLs for individual posts (GET variables, etc)
        // Possibly rework to include a unique post ID (or whatever)
        if ($recent) {
            foreach ($recent as $key => $val) {
                if ($val['url'] == $current_page['url']) {
                    unset($recent[$key]);
                }
            }
        }

        // Push the current page into the recently viewed posts array
        $recent[time()] = $current_page;

        // If more than $num_to_store elements, then delete everything except the newest $num_to_store
        if (count($recent) > $num_to_store) {
            // These are already in the correct order, but would theoretically be logical to sort by key here.
            $recent = array_slice($recent, count($recent) - 5, count($recent), true);
        }

        // Queue the updated "recently viewed" list to update on the user's next page load
        // I.e., don't show the current page as "recently viewed" until they navigate away from it (or otherwise refresh the page)
        Cookie::queue('recently_viewed_content', json_encode($recent), $minutes_to_store);
    }
}
