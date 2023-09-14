<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Domain\Users\Models;

use App\Domain\Nodes\Models\Node;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Arr;
use Laravel\Passport\HasApiTokens;
use Laravel\Scout\Searchable;

/**
 * @property mixed id
 * @property null email_verified_at
 * @property mixed username
 */
class User extends Authenticatable
{
    use Notifiable;
    use Searchable;
    use HasApiTokens;

    protected $guarded = [];

    /**
     * The attributes that should be cast to native types.
     *
     * @var array
     */
    protected $casts
        = [
            'preferences' => 'array',
            'metadata' => 'array',
            'administrator' => 'boolean',
        ];

    public function toSearchableArray()
    {
        return $this->only(['id', 'username', 'first_name', 'last_name', 'email']);
    }

    // =======================================
    // Node Permissions
    // =======================================

    public function accessibleNodes()
    {
        return $this->belongsToMany(Node::class);
    }

    /*
    >|-----------------------------------------
    >| Preferences
    >|-----------------------------------------
    */

    /**
     * Retrieve a setting with a given name or fall back to the default.
     *
     *
     * @return mixed
     */
    public function preference(string $preference)
    {
        if ($this->preferences !== null) {
            if (array_key_exists($preference, $this->preferences)) {
                return $this->preferences[$preference];
            }
        }

        return $this->getDefaultPreference($preference);
    }

    /**
     *    Gets the default preference from default_user_preferences.json
     *
     *
     * @return mixed
     */
    public function getDefaultPreference(string $preference)
    {
        $elements = explode('.', $preference);
        $section = $elements[0];
        $subsection = count($elements) < 3 ? null : $elements[1];
        $name = count($elements) < 3 ? $elements[1] : $elements[2];

        $path = storage_path()
            . '/json/default_user_preferences.json'; // ie: /var/www/laravel/app/storage/json/filename.json
        $json = json_decode(file_get_contents($path), true);

        // 2-deep setting
        if ($subsection === null) {
            if (! isset($json[$section]['preferences'][$name])) {
                return null;
            }

            return $json[$section]['preferences'][$name]['value'];
        }

        if (! isset($json[$section]['subsections'][$subsection]['preferences'][$name])) {
            return null;
        }

        return $json[$section]['subsections'][$subsection]['preferences'][$name]['value'];
    }

    /**
     * Update one or more settings and then optionally save the model.
     */
    public function setPreference(array $revisions, bool $save = true): self
    {
        if ($this->preferences === null) {
            $this->preferences = [];
        }

        $this->preferences = array_merge($this->preferences, $revisions);
        if ($save) {
            $this->save();
        }

        return $this;
    }

    /**
     *    Resets the user's preference to the default value
     *
     * @param  bool  $save
     */
    public function resetPreference($preference, $save = true): void
    {
        if (isset($this->preferences[$preference])) {
            $output = Arr::except($this->preferences, $preference);
            $this->preferences = $output;

            if ($save) {
                $this->save();
            }
        }
    }

    public function array_except($array, $keys)
    {
        return array_diff_key($array, array_flip((array) $keys));
    }

    /**
     *    Splices the default settings file with the user's known preferences
     */
    public function getFullPreferencesAttribute()
    {
        // This splices the known preferences in the user's `preferences` column with the `default_user_preferences` file.
        $usersPreferences = $this->preferences;

        // 1. Get the full default_user_preferences file
        $path = storage_path()
            . '/json/default_user_preferences.json'; // ie: /var/www/laravel/app/storage/json/filename.json
        $defaultUserPreferences = json_decode(file_get_contents($path), true);

        // 2. Iterate through the users preferences, modifying the value of the full file's key
        if ($usersPreferences !== null) {
            foreach ($usersPreferences as $key => $preference) {
                $elements = explode('.', $key);
                $section = $elements[0];
                $subsection = count($elements) < 3 ? null : $elements[1];
                $name = count($elements) < 3 ? $elements[1] : $elements[2];

                if ($subsection === null) {
                    $defaultUserPreferences[$section]['preferences'][$name]['value'] = $preference;
                } else {
                    $defaultUserPreferences[$section]['subsections'][$subsection]['preferences'][$name]['value']
                        = $preference;
                }
            }
        }

        return $defaultUserPreferences;
    }

    /*
    >|-----------------------------------------
    >| Meta
    >|-----------------------------------------
    */

    /**
     * Retrieve a meta with a given name or fall back to the default.
     *
     *
     * @return mixed
     */
    public function meta(string $meta)
    {
        if ($this->metadata !== null) {
            if (array_key_exists($meta, $this->metadata)) {
                return $this->metadata[$meta];
            }
        }

        return $this->getDefaultMeta($meta);
    }

    /**
     *    Gets the default preference from default_user_meta.json
     *
     *
     * @return mixed
     */
    public function getDefaultMeta(string $meta)
    {
        $path = storage_path() . '/json/default_user_meta.json';
        $json = json_decode(file_get_contents($path), true);

        if (! isset($json[$meta])) {
            return null;
        }

        return $json[$meta]['value'];
    }

    /**
     * Update one or more metas and then optionally save the model.
     */
    public function setMeta(array $revisions, bool $save = true): self
    {
        if ($this->metadata === null) {
            $this->metadata = [];
        }

        $this->metadata = array_merge($this->metadata, $revisions);
        if ($save) {
            $this->save();
        }

        return $this;
    }

    /**
     *    Resets the user's meta to the default value
     *
     * @param  bool  $save
     */
    public function resetMeta($meta, $save = true): void
    {
        if (isset($this->metadata[$meta])) {
            $output = $this->array_except($this->metadata, $meta);
            $this->metadata = $output;

            if ($save) {
                $this->save();
            }
        }
    }

    /**
     *    Splices the default meta file with the user's known preferences
     */
    public function getFullMetaAttribute()
    {
        // This splices the known preferences in the user's `preferences` column with the `default_user_preferences` file.
        $usersMeta = $this->metadata;

        // 1. Get the full default_user_preferences file
        $path = storage_path() . '/json/default_user_meta.json';
        $defaultUserMeta = json_decode(file_get_contents($path), true);

        // 2. Iterate through the users meta, modifying the value of the full file's key
        if ($usersMeta !== null) {
            foreach ($usersMeta as $key => $meta) {
                $defaultUserMeta[$key]['value'] = $meta;
            }
        }

        return $defaultUserMeta;
    }
}
