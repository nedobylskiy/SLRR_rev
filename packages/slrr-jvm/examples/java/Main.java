package demo;

import demo.Helper;
import demo.HostMath;

class Main {
    int run(int number) {
        return Helper.twice(number) + HostMath.offset();
    }
}
