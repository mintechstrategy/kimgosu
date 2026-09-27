package com.mintechstrategy.kimgosu;

/** Access token and customer profile returned by the backend after CI login. */
final class AuthSession {
    final String accessToken;
    final String userId;
    final String customerName;
    final String birthDate;
    final String homeAddress;
    final boolean expertEnabled;

    AuthSession(String accessToken, String userId, String customerName,
                String birthDate, String homeAddress, boolean expertEnabled) {
        this.accessToken = accessToken;
        this.userId = userId;
        this.customerName = customerName;
        this.birthDate = birthDate;
        this.homeAddress = homeAddress;
        this.expertEnabled = expertEnabled;
    }
}
