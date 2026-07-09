cmake_minimum_required(VERSION 3.9)
cmake_policy(SET CMP0042 NEW)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

project (node-gssapi)

set(KRB5_DIR
    "$ENV{KRB5_DIR}"
    CACHE
    PATH
    "Root of MIT Kerberos source tree (optional).")
mark_as_advanced(KRB5_DIR)

if(CMAKE_SIZEOF_VOID_P EQUAL 8)
  set (bit_suffix 64)
else()
  set (bit_suffix 32)
endif()

find_path(KRB5_INCLUDE_DIR krb5.h PATHS ${KRB5_DIR}/include)
mark_as_advanced(KRB5_INCLUDE_DIR)
find_library(KRB5_KRB5_LIB NAMES krb5 "krb5_${bit_suffix}" PATHS ${KRB5_DIR}/lib ${KRB5_DIR}/lib/amd64 ${KRB5_DIR}/lib/i386})
find_library(KRB5_COM_ERR_LIB NAMES com_err "comerr${bit_suffix}" PATHS ${KRB5_DIR}/lib ${KRB5_DIR}/lib/amd64 ${KRB5_DIR}/lib/i386})
find_library(KRB5_GSSAPI_LIB NAMES gssapi_krb5 "gssapi${bit_suffix}" PATHS ${KRB5_DIR}/lib ${KRB5_DIR}/lib/amd64 ${KRB5_DIR}/lib/i386})

set(KRB5_LIBRARIES
    ${KRB5_KRB5_LIB}
    ${KRB5_COM_ERR_LIB}
    ${KRB5_GSSAPI_LIB}
    )
mark_as_advanced(KRB5_LIBRARIES)

if (NOT KRB5_KRB5_LIB OR NOT KRB5_COM_ERR_LIB OR NOT KRB5_GSSAPI_LIB)
message(FATAL_ERROR "Could not find all Kerberos libraries. Perhaps you need to set KRB5_DIR in your environment")
endif()

execute_process(COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    )
string(REPLACE "\n" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})
string(REPLACE "\"" "" NODE_ADDON_API_DIR ${NODE_ADDON_API_DIR})


add_library(node-gssapi SHARED src/bind.cc src/module.cc ${CMAKE_JS_SRC})
target_include_directories(node-gssapi PRIVATE  ${CMAKE_JS_INC} ${NODE_ADDON_API_DIR} ${KRB5_INCLUDE_DIR})
target_link_libraries(node-gssapi PRIVATE ${CMAKE_JS_LIB} ${KRB5_LIBRARIES})
set_target_properties(node-gssapi PROPERTIES PREFIX "" SUFFIX ".node")
target_compile_definitions(node-gssapi PUBLIC -DNAPI_VERSION=5)
