<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}" class="{{ Auth::user() && Auth::user()->preference('appearance.colours.dark_mode') ? 'theme-dark' : 'theme-light' }}">
<head>

    <title>ACS | Manager</title>

    <link rel="icon" sizes="32x32" href="{{ Vite::asset('resources/assets/img/favicon.svg') }}">
    <link rel="icon" sizes="16x16" href="{{ Vite::asset('resources/assets/img/favicon.svg') }}">

    <script src="https://kit.fontawesome.com/fb885729aa.js" crossorigin="anonymous"></script>

    <!---------------------------------------->
    <!----------------- Meta ----------------->
    <!---------------------------------------->
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="pusherAppKey" content="{{ env('PUSHER_APP_KEY') }}">
    <meta name="appEnv" content="{{ config('app.env') }}">
    <meta name="user" content="{{ auth()->check() ? json_encode(Auth::user()) : '{}' }}">
    <meta name="userPreferences" content="{{ auth()->check() ? json_encode(Auth::user()->full_preferences) : '{}' }}">

    @yield('meta')

    {{-- Styles--}}
    @yield('styles')

    {{--Head--}}
    @yield('head')

</head>

<body id="body">
<div id="app" class="relative antialiased">
    <main>
        @if (Session::has('notification'))
            <notification type="{{ session('notificationType') ?? 'success' }}"
                                    title="{{ session('notification') }}"
                                    description="{{ session('notificationDescription') }}"></notification>
        @else
            <notification></notification>
        @endif
        <reauthenticate></reauthenticate>
    </main>
    @yield('page')
</div>

{{--Scripts--}}
@vite(['resources/js/app.js'])
<script>
  window.Laravel = {!! json_encode([
            'csrfToken' => csrf_token(),
            'user' => Auth::user(),
        ]) !!}
</script>
@yield('scripts')
</body>
</html>
