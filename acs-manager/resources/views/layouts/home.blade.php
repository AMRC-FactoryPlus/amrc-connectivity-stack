@section('title', 'Home')
@extends('layouts.app')

@section('page')
    <dashboard>
        @yield('content')
    </dashboard>
@endsection